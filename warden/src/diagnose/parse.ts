// warden/src/diagnose/parse.ts
//
// WHERE A MODEL'S REPLY STOPS BEING TEXT AND BECOMES DATA — or is refused.
//
// Everything Claude returns is untrusted output derived, in part, from
// untrusted input: a listing title, a complaint body or an nginx log line can
// steer what it writes. So nothing here is coerced into working. The two
// standing rules:
//
//   REFUSE, DON'T COERCE — anything that decides IDENTITY is exact-matched
//   and a mismatch drops the item: the kind, the fix form, the operation
//   name, its argument values, whether a fix exists at all. A near-miss is a
//   different item, not a repairable one. "red-gate" where "red_gate" belongs
//   is refused, never fixed up, because the two spellings mean different
//   things on the wire and a silent repair would turn "no fix exists" into an
//   approvable button.
//
//   CAP, DON'T REFUSE, FOR LENGTH — a headline or a diagnosis over the wire's
//   own cap is truncated, because the backend's normaliser truncates it
//   anyway and losing a real fault to a long sentence helps nobody. A COMMAND
//   is the exception and is refused rather than truncated: truncating a
//   command changes what would run.
//
// ONE BAD ITEM IS NOT A BAD SWEEP. A malformed item is refused on its own and
// the rest are kept — the same rule the checks engine follows when one check
// throws. Only a reply that is not a parseable object at all fails whole.
//
// ⚠️ NOTHING HERE RUNS ANYTHING. `build()` is called on a safe-list operation
// for its `describe` string only; it constructs a closure and returns, and the
// closure's `run` is never touched in this file. That is what makes "the
// command you return must be the command you run" true by construction rather
// than by convention: both strings come from the same build().

import { findSafeListOperation, assertNotObviouslyDestructive } from '../exec/index.js';
import type { Refusal } from './types.js';

/** Wire caps, mirrored from warden.service.ts's normaliser. */
const MAX_HEADLINE = 300;
const MAX_DIAGNOSIS = 4_000;
const MAX_COMMAND = 8_000;
const MAX_GATE_KEY = 100;
/** A reply proposing more than this is not a diagnosis, it is noise. */
const MAX_ITEMS = 20;

/**
 * The validated forms. Note there is no `command` field on the red-gate
 * variant AT ALL — rule 6 ("a red gate has no command") is enforced by the
 * type system here, not by remembering to null a field later. A red gate
 * carrying a fix is not nulled; it is refused as a contradiction, because a
 * model that says "I cannot fix this" and hands over a fix has told us two
 * incompatible things and we do not get to pick which one it meant.
 */
export type ValidatedItem =
  | {
      kind: 'proposal';
      headline: string;
      diagnosis: string;
      command: string;
      /** Present for a safe-list pick; null for an operator-approved command. */
      operation: { name: string; args: Record<string, string | number | boolean> } | null;
      reversible: boolean;
      gateKey: string | null;
      checkIds: string[];
    }
  | {
      kind: 'red_gate';
      headline: string;
      diagnosis: string;
      gateKey: string | null;
      checkIds: string[];
    };

export type ParseOutcome =
  | { ok: true; items: ValidatedItem[]; refusals: Refusal[] }
  | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Control characters out (they corrupt storage and the rendered thread),
 *  newlines kept (prose has paragraphs), then capped. Deliberately NOT
 *  sanitizeScalar: that one exists to make text safe to put INTO a prompt and
 *  destroys quotes and apostrophes, which real prose needs. This text is
 *  going to a React text node, which escapes on its own. */
function plainText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, ' ')
    .trim()
    .slice(0, max);
}

function stringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => plainText(x, 120))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Pull the JSON object out of a reply. Models wrap JSON in a ```json fence or
 * a sentence often enough that refusing on that alone would throw away good
 * diagnoses; the extraction is deliberately dumb (first `{` to last `}`) and
 * anything that is not then valid JSON is refused outright, never repaired.
 */
function extractJson(text: string): unknown | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as unknown;
  } catch {
    return null;
  }
}

export function parseDiagnosisReply(replyText: string): ParseOutcome {
  if (typeof replyText !== 'string' || replyText.trim() === '') {
    return { ok: false, reason: 'the model returned no text' };
  }

  const root = extractJson(replyText);
  if (root === null) {
    return { ok: false, reason: 'the reply did not contain a JSON object' };
  }
  if (!isRecord(root)) {
    // A top-level array is the most common near-miss and the most tempting to
    // "just accept" — it is refused, because accepting one shape when another
    // was specified is how a parser starts guessing.
    return { ok: false, reason: 'the reply was JSON but not an object with an "items" array' };
  }
  const rawItems = root.items;
  if (!Array.isArray(rawItems)) {
    return { ok: false, reason: '"items" was missing or was not an array' };
  }

  const items: ValidatedItem[] = [];
  const refusals: Refusal[] = [];

  rawItems.slice(0, MAX_ITEMS).forEach((raw, index) => {
    const one = validateItem(raw);
    if (one.ok) items.push(one.item);
    else refusals.push({ index, reason: one.reason });
  });

  if (rawItems.length > MAX_ITEMS) {
    refusals.push({
      index: MAX_ITEMS,
      reason: `the reply carried ${rawItems.length} items; only the first ${MAX_ITEMS} were read`,
    });
  }

  return { ok: true, items, refusals };
}

type ItemOutcome = { ok: true; item: ValidatedItem } | { ok: false; reason: string };

function validateItem(raw: unknown): ItemOutcome {
  if (!isRecord(raw)) return { ok: false, reason: 'item was not an object' };

  // IDENTITY FIELDS — exact match or refuse. `kind` is checked against the
  // two literals with no normalisation of case, hyphens or underscores: the
  // hyphenated 'red-gate' is a MESSAGE kind and means something else, and
  // quietly accepting it here would mint an approvable red gate.
  const kind = raw.kind;
  if (kind !== 'proposal' && kind !== 'red_gate') {
    return { ok: false, reason: `kind must be exactly "proposal" or "red_gate" (got ${JSON.stringify(kind)})` };
  }

  const headline = plainText(raw.headline, MAX_HEADLINE);
  if (!headline) return { ok: false, reason: 'headline was missing or empty' };

  // A proposal with no stated reasoning is not reviewable, and "approve this,
  // I won't say why" is exactly the shape a poisoned fact would produce.
  const diagnosis = plainText(raw.diagnosis, MAX_DIAGNOSIS);
  if (!diagnosis) return { ok: false, reason: 'diagnosis was missing or empty' };

  const gateKeyRaw = plainText(raw.gateKey, MAX_GATE_KEY);
  const gateKey = gateKeyRaw || null;
  const checkIds = stringArray(raw.checkIds, 12);

  const fix = raw.fix;
  if (!isRecord(fix)) return { ok: false, reason: 'fix was missing or not an object' };
  const fixType = fix.type;

  if (kind === 'red_gate') {
    // A red gate that arrived carrying a fix is a contradiction, not a shape
    // to tidy. Refused rather than nulled: the model has said two
    // incompatible things and neither reading is safe to adopt on its own.
    if (fixType !== 'none') {
      return {
        ok: false,
        reason: `a red gate must carry fix.type "none"; this one carried ${JSON.stringify(fixType)}`,
      };
    }
    return { ok: true, item: { kind: 'red_gate', headline, diagnosis, gateKey, checkIds } };
  }

  // kind === 'proposal' from here.
  if (fixType === 'none') {
    return { ok: false, reason: 'a proposal must carry a fix; fix.type "none" belongs to a red gate' };
  }

  if (fixType === 'safe_list') {
    return validateSafeListFix(fix, { headline, diagnosis, gateKey, checkIds });
  }

  if (fixType === 'command') {
    return validateCommandFix(fix, { headline, diagnosis, gateKey, checkIds });
  }

  return { ok: false, reason: `fix.type must be "safe_list", "command" or "none" (got ${JSON.stringify(fixType)})` };
}

interface ItemCommon {
  headline: string;
  diagnosis: string;
  gateKey: string | null;
  checkIds: string[];
}

/**
 * A safe-list pick. The operation NAME is looked up in SAFE_LIST — not
 * matched loosely, not fuzzy-corrected — and the ARGS go through that
 * operation's own validate(), the same function the executor will run them
 * through again before executing. The command string is then built by
 * build().describe from the VALIDATED args.
 *
 * 🚨 THE MODEL'S OWN COMMAND TEXT, IF IT SENT ANY, IS NEVER READ HERE. That
 * is the single line that makes a hostile string inside a fenced log line
 * unable to change what a safe-list proposal will run: there is no branch in
 * which anything the model wrote reaches `command`.
 */
function validateSafeListFix(fix: Record<string, unknown>, common: ItemCommon): ItemOutcome {
  const name = fix.operation;
  if (typeof name !== 'string' || name === '') {
    return { ok: false, reason: 'fix.operation was missing or not a string' };
  }
  const op = findSafeListOperation(name);
  if (!op) {
    return { ok: false, reason: `"${plainText(name, 80)}" is not on the safe list` };
  }
  const validated = op.validate(fix.args ?? {});
  if (!validated.ok) {
    return { ok: false, reason: `${op.name}: ${validated.error}` };
  }

  const built = op.build(validated.args);

  return {
    ok: true,
    item: {
      kind: 'proposal',
      headline: common.headline,
      diagnosis: common.diagnosis,
      command: built.describe,
      operation: { name: op.name, args: argRecord(validated.args) },
      // The LIST's claim about reversibility, never the model's — the model
      // does not get a vote on how safe an operation the daemon owns is.
      reversible: op.reversible,
      gateKey: common.gateKey,
      checkIds: common.checkIds,
    },
  };
}

/**
 * A command outside the list. It is not run here and will not be run by
 * anything until an operator reads this exact string in the money-grade
 * confirm and approves it, at which point the backend compare-and-swaps
 * against it. So this validates that it is a reviewable string and nothing
 * more.
 *
 * Length is REFUSED rather than capped, unlike every other field: a truncated
 * command is a different command.
 */
function validateCommandFix(fix: Record<string, unknown>, common: ItemCommon): ItemOutcome {
  const raw = fix.command;
  if (typeof raw !== 'string') return { ok: false, reason: 'fix.command was missing or not a string' };
  const command = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, '').trim();
  if (!command) return { ok: false, reason: 'fix.command was empty' };
  if (command.length > MAX_COMMAND) {
    return { ok: false, reason: `fix.command was ${command.length} characters; the reviewable limit is ${MAX_COMMAND}` };
  }
  if (command.includes('\n')) {
    // A multi-line script cannot be read at a glance in a confirm dialog, and
    // the confirm dialog being readable is the entire control on this path.
    return { ok: false, reason: 'fix.command spanned multiple lines; a command an operator must read has to be one line' };
  }

  const guard = assertNotObviouslyDestructive(command);
  if (!guard.ok) {
    // executor.ts's documented behaviour for a denylist hit: the proposal
    // becomes a red gate rather than growing an Approve button. The refused
    // command TEXT is deliberately not carried into the red gate's prose —
    // naming the pattern that fired tells the operator what happened without
    // handing them a string to paste into a terminal.
    return {
      ok: true,
      item: {
        kind: 'red_gate',
        headline: common.headline,
        diagnosis: `${common.diagnosis}\n\nWarden drafted a command for this and then withheld it: it matched the destructive-command denylist (pattern: ${guard.matched}). There is no approve button for it and the text is not repeated here. Handle this one by hand.`.slice(
          0,
          MAX_DIAGNOSIS,
        ),
        gateKey: common.gateKey,
        checkIds: common.checkIds,
      },
    };
  }

  return {
    ok: true,
    item: {
      kind: 'proposal',
      headline: common.headline,
      diagnosis: common.diagnosis,
      command,
      operation: null,
      // Anything but an explicit `true` is read as NOT reversible. Unknown
      // reversibility and irreversibility get the same, louder confirm — the
      // conservative reading is the only safe default here.
      reversible: fix.reversible === true,
      gateKey: common.gateKey,
      checkIds: common.checkIds,
    },
  };
}

/** Narrow validated args to the primitive record the audit row stores. */
function argRecord(v: unknown): Record<string, string | number | boolean> {
  if (!isRecord(v)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[k] = val;
  }
  return out;
}
