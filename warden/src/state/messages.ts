// warden/src/state/messages.ts
//
// The thread's own voice, and the last gate before anything reaches the wire.
//
// Two jobs:
//
//   BUILDERS — the messages the diagnosis layer deliberately does not write,
//   because they need the measurements and the audit records rather than a
//   model: 'finding' when a check turns, 'fixed' when it comes back, 'ran'
//   with the real transcript once a command has actually run.
//
//   PROJECTION — projectMessage / projectProposal apply the backend's OWN
//   normalisation rules before we send, so what we emit is what survives.
//
// 🚨 WHY PROJECT AT ALL, GIVEN THE BACKEND ALREADY NORMALISES. Because it
// normalises by DROPPING, silently, with no error on either side of the wire.
// A message whose kind is misspelled, whose body filtered down to nothing, or
// whose `at` will not parse does not arrive broken — it does not arrive. A
// fault Warden found and reported would simply never appear in the thread,
// and nothing anywhere would say so. Dropping here instead means the count is
// ours and the daemon can log it.
//
// 🚨 THE TWO SPELLINGS. A chat MESSAGE kind is 'red-gate' (HYPHEN); a
// PROPOSAL kind is 'red_gate' (UNDERSCORE). Each is exact-matched on the far
// side and neither is corrected. They are near-identical by eye and this file
// touches both, so both are pinned by tests.

import { randomUUID } from 'node:crypto';
import {
  WARDEN_MESSAGE_KINDS,
  WARDEN_ID_RE,
  type CheckResult,
  type CheckStatus,
  type WardenChatMessage,
  type WardenAuditEntry,
  type WardenMessageKind,
  type WardenProposal,
  type WardenTruncatedText,
} from '../types.js';
import { truncateOutput, type TruncatedText, type WardenAuditRecord } from '../exec/index.js';
import type { StoredProposal } from './store.js';

// ── the backend's caps, mirrored ────────────────────────────────────────
// warden.service.ts's normaliseMessage/normaliseProposal. Hand-mirrored, as
// warden/ has no import path into backend/src.

const MAX_TEXT = 4_000;
const MAX_ID = 64;
const MAX_PARAGRAPHS = 12;
const MAX_PRE_LINES = 40;
const MAX_PRE_LINE = 500;
const MAX_FOOTNOTE = 200;
const MAX_HEADLINE = 300;
const MAX_COMMAND = 8_000;
const MAX_GATE_KEY = 100;

const VALID_PROPOSAL_STATUSES: ReadonlySet<string> = new Set(['pending', 'approved', 'declined', 'acknowledged']);

function text(v: unknown, max = MAX_TEXT): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function isParseableDate(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}

/**
 * Apply exactly what the backend applies, and return null where the backend
 * would drop the whole record. Never repairs: a kind outside the six is not
 * coerced to 'note' here any more than it is there — a message we cannot name
 * correctly is a message we do not understand, and shipping it under a
 * different label would put words in Warden's mouth.
 */
export function projectMessage(raw: WardenChatMessage): WardenChatMessage | null {
  const id = text(raw?.id, MAX_ID);
  if (!id) return null;
  if (!isParseableDate(raw?.at)) return null;
  const kind = WARDEN_MESSAGE_KINDS.find((k) => k === raw?.kind);
  if (!kind) return null;

  const body = (Array.isArray(raw.body) ? raw.body : [])
    .map((p) => text(p))
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS);
  if (body.length === 0) return null;

  const out: WardenChatMessage = {
    id,
    role: raw.role === 'operator' ? 'operator' : 'warden',
    kind,
    at: raw.at,
    body,
  };

  if (raw.pre && Array.isArray(raw.pre.lines)) {
    const lines = raw.pre.lines.map((l) => text(l, MAX_PRE_LINE)).filter(Boolean).slice(0, MAX_PRE_LINES);
    if (lines.length > 0) out.pre = { tone: raw.pre.tone === 'ground' ? 'ground' : 'inset', lines };
  }

  // A proposalId outside the charset is stripped rather than sent: it lands
  // in a URL path on the far side, and a link that cannot be followed is
  // worse than no link.
  // ⚠️ TESTED WHOLE, NEVER TRUNCATED FIRST. Truncating an over-length id to 64
  // and then finding it "valid" produces an id that IS well-formed and points
  // at nothing — the store still holds the original. A dangling link that
  // looks real is worse than an absent one.
  if (typeof raw.proposalId === 'string' && WARDEN_ID_RE.test(raw.proposalId)) out.proposalId = raw.proposalId;

  const footnote = text(raw.footnote, MAX_FOOTNOTE);
  if (footnote) out.footnote = footnote;

  return out;
}

/**
 * The wire projection of a stored proposal. Strips the daemon-internal fields
 * (`operation`, `checkIds`, `faultKey`, the resolution trail) — the backend
 * ignores unknown keys, but a shape that leaks internals invites something
 * downstream to start depending on them.
 */
export function projectProposal(p: StoredProposal): WardenProposal | null {
  // ⚠️ NOT TRUNCATED. WARDEN_ID_RE already caps at 64; cutting a longer id down
  // to fit would mint a well-formed id that this store does not hold, so
  // approve would 404 on a button that looked perfectly normal.
  const id = typeof p?.id === 'string' ? p.id : '';
  if (!WARDEN_ID_RE.test(id)) return null;
  if (p.kind !== 'proposal' && p.kind !== 'red_gate') return null;
  if (!VALID_PROPOSAL_STATUSES.has(p.status)) return null;
  const headline = text(p.headline, MAX_HEADLINE);
  if (!headline) return null;
  if (!isParseableDate(p.raisedAt)) return null;

  const command = text(p.command, MAX_COMMAND);
  const gateKey = text(p.gateKey, MAX_GATE_KEY);

  return {
    id,
    kind: p.kind,
    status: p.status,
    headline,
    diagnosis: text(p.diagnosis, MAX_TEXT),
    // Rule 6. The backend forces this to null too, but a red gate that
    // carried a command would be an approvable red gate and this daemon must
    // never rely on the far side to catch that.
    command: p.kind === 'red_gate' ? null : command || null,
    gateKey: gateKey || null,
    raisedAt: p.raisedAt,
  };
}

// ── builders ────────────────────────────────────────────────────────────

export function newMessageId(): string {
  return `msg_${randomUUID()}`.slice(0, MAX_ID);
}

interface BuildOpts {
  at: string;
  kind: WardenMessageKind;
  body: string[];
  role?: 'warden' | 'operator';
  pre?: { tone: 'inset' | 'ground'; lines: string[] };
  proposalId?: string;
  footnote?: string;
}

function build(o: BuildOpts): WardenChatMessage {
  const msg: WardenChatMessage = {
    id: newMessageId(),
    role: o.role ?? 'warden',
    kind: o.kind,
    at: o.at,
    body: o.body.filter(Boolean),
  };
  if (o.pre && o.pre.lines.length > 0) msg.pre = o.pre;
  if (o.proposalId) msg.proposalId = o.proposalId;
  if (o.footnote) msg.footnote = o.footnote;
  return msg;
}

export function note(at: string, body: string[], pre?: { tone: 'inset' | 'ground'; lines: string[] }): WardenChatMessage {
  return build({ at, kind: 'note', body, pre });
}

export function operatorSaid(at: string, said: string): WardenChatMessage {
  return build({ at, kind: 'note', role: 'operator', body: [said] });
}

/**
 * A check turned. Written on the TRANSITION only — a 'finding' every sweep
 * for a fault nobody has fixed would bury the one that just appeared.
 *
 * ⚠️ A move to `unknown` is a finding, not a recovery. "Stopped being
 * measurable" is news: it is how a permissions change, a moved log or a dead
 * psql presents, and calling it anything softer is the plausible-zero this
 * daemon exists to refuse.
 */
export function findingMessage(result: CheckResult, previous: CheckStatus | null, at: string): WardenChatMessage {
  const from = previous ? ` It was ${previous} before this sweep.` : '';
  const body = [`${result.title}: ${result.verdict}${from}`];
  // e.value is already redacted — ev() in checks/result.ts strips secrets at
  // construction, so nothing here can ship one to the Desk unredacted.
  const lines = result.evidence.slice(0, MAX_PRE_LINES).map((e) => (e.from ? `${e.label}: ${e.value}   [${e.from}]` : `${e.label}: ${e.value}`));
  return build({
    at,
    kind: 'finding',
    body,
    // 'inset', not 'ground': evidence is a reading, not a transcript of
    // something Warden ran on the operator's behalf.
    pre: lines.length > 0 ? { tone: 'inset', lines } : undefined,
    footnote: `${result.id} · measured ${result.measuredAt}`,
  });
}

/**
 * A check came back to ok.
 *
 * 🚨 THE KIND IS A CLAIM ABOUT WHO DID IT, AND IT WAS WRONG FOR EVERY
 * MESSAGE THIS FUNCTION HAS EVER EMITTED. The Desk renders kind 'fixed' with
 * the tag "fixed alone" — meaning Warden fixed it, unattended. This function
 * is called from ONE place, WardenCore.transitionMessages(), which compares
 * two sweeps: it knows a row went bad→ok and it cannot possibly know why.
 * In practice the answer was always "a human" — runSafeListOperation(), the
 * only unattended path, has no caller in this daemon outside its own tests,
 * so "fixed alone" has never once been literally true on this box. An
 * operator who repaired nginx by hand at 02:00 was told the agent had done
 * it.
 *
 * So `by` is now required and the kind follows it:
 *   · 'warden'  → kind 'fixed'. Reserved for a recovery Warden can actually
 *                 attribute to its own run. Nothing reaches it today; that
 *                 is the honest state, not a gap to paper over.
 *   · 'unknown' → kind 'note', and the prose says outright that Warden did
 *                 not do it.
 *
 * ⚠️ DO NOT "TIDY UP" THE NOW-UNREACHABLE 'fixed' BRANCH BY DELETING THE
 * KIND. WARDEN_MESSAGE_KINDS is a THREE-way hand mirror — this file,
 * backend/src/desk/warden.types.ts and frontend/components/desk/chat.tsx's
 * KIND_TAG. Dropping a kind from one side does not raise an error anywhere;
 * it drops messages on the wire, silently, in whichever direction the lists
 * disagree.
 */
export function fixedMessage(
  result: CheckResult,
  previous: CheckStatus | null,
  at: string,
  by: 'warden' | 'unknown',
): WardenChatMessage {
  const from = previous ? `was ${previous}, ` : '';
  if (by === 'warden') {
    return build({
      at,
      kind: 'fixed',
      body: [`${result.title} is back to ok after something I ran — ${from}now: ${result.verdict}`],
      footnote: `${result.id} · measured ${result.measuredAt}`,
    });
  }
  return build({
    at,
    kind: 'note',
    body: [
      `${result.title} is back to ok — ${from}now: ${result.verdict}`,
      'I did not do that. I only see that the reading changed between two sweeps; something outside me cleared it.',
    ],
    footnote: `${result.id} · measured ${result.measuredAt}`,
  });
}

/**
 * A command that HAS run, with the real transcript. `tone: 'ground'` is
 * reserved for exactly this — output that actually came off the box — so an
 * operator can tell a transcript from a preview at a glance.
 *
 * The output is the audit record's, which was redacted and THEN truncated by
 * exec/audit.ts. Nothing here re-formats it: rule 7 says verbatim, with the
 * truncation stated.
 */
export function ranMessage(record: WardenAuditRecord, at: string): WardenChatMessage {
  const lines: string[] = [`$ ${record.command}`];
  if (record.stdout.text) lines.push(...record.stdout.text.split('\n'));
  if (record.stderr.text) lines.push('--- stderr ---', ...record.stderr.text.split('\n'));
  if (record.stdout.truncated) lines.push(`… stdout truncated; ${record.stdout.originalBytes} bytes in full.`);
  if (record.stderr.truncated) lines.push(`… stderr truncated; ${record.stderr.originalBytes} bytes in full.`);
  if (lines.length === 1) lines.push('(no output)');

  const outcome = record.timedOut
    ? `It timed out after ${Math.round(record.durationMs / 1000)}s and was killed.`
    : record.exitCode === 0
      ? `It exited 0 after ${Math.round(record.durationMs / 1000)}s.`
      : `It exited ${record.exitCode === null ? 'without a code' : String(record.exitCode)} after ${Math.round(record.durationMs / 1000)}s.`;

  const redacted =
    record.redactions.length > 0
      ? ` I redacted ${record.redactions.length} value${record.redactions.length === 1 ? '' : 's'} from the output (${record.redactions.join(', ')}).`
      : '';

  return build({
    at,
    kind: 'ran',
    body: [`${outcome}${redacted}`],
    pre: { tone: 'ground', lines },
    proposalId: record.proposalId,
    footnote: footnoteFor(record),
  });
}

/** "ran · re-checked" — but only ever claimed when a re-measurement actually
 *  happened. `recheck: null` means nobody has looked yet, which is a
 *  different statement from "looked and could not tell". */
function footnoteFor(record: WardenAuditRecord): string {
  const who = record.trigger === 'operator_approved' ? `approved by ${record.operatorId ?? 'an operator'}` : 'ran unattended from the safe list';
  if (!record.recheck) return `${who} · not re-checked yet`;
  const verdict =
    record.recheck.result === 'ok' ? 're-checked, clear' : record.recheck.result === 'still-bad' ? 're-checked, still bad' : 're-checked, could not tell';
  return `${who} · ${verdict}`;
}

/** The acknowledgement that a run has STARTED. Deliberately a 'note' and not
 *  a 'ran': there is no transcript yet, and a 'ran' message with a preview in
 *  it would blur the one distinction the two tones exist to keep sharp. */
export function startedMessage(proposal: StoredProposal, at: string): WardenChatMessage {
  return build({
    at,
    kind: 'note',
    body: [
      'Approved — I have started it. I am not holding this request open while it runs, because the Desk would time out first; the transcript will appear here when it finishes.',
    ],
    pre: { tone: 'inset', lines: [proposal.command ?? ''] },
    proposalId: proposal.id,
  });
}

export function declinedMessage(proposal: StoredProposal, reason: string | null, at: string): WardenChatMessage {
  const body = [
    reason
      ? `Declined, and I have written the reason down as a standing instruction so later sweeps honour it: "${reason}"`
      : 'Declined. You gave no reason, so I have not written anything down — I may raise this again on a later sweep.',
  ];
  return build({ at, kind: 'note', body, proposalId: proposal.id });
}

export function standingList(instructions: readonly { text: string; source: string }[], at: string, lead: string): WardenChatMessage {
  if (instructions.length === 0) {
    return note(at, [`${lead} I am holding no standing instructions.`]);
  }
  return build({
    at,
    kind: 'note',
    body: [`${lead} These are the standing instructions I am holding and echoing into every sweep. Say "forget: <number>" to drop one.`],
    pre: {
      tone: 'inset',
      lines: instructions.map((s, i) => `${i + 1}. ${s.text}${s.source === 'decline' ? '   [from a declined proposal]' : ''}`),
    },
  });
}

// ── the audit trail, projected for the wire ─────────────────────────────

/**
 * ⚠️ THE SECOND CLAMP, AND IT IS NOT THE SAME CLAMP exec/audit.ts APPLIED.
 * A record holds up to MAX_OUTPUT_BYTES (20 KB) of stdout and the same of
 * stderr. Fifty of those is a 2 MB body against a backend read budget of
 * eight seconds, over a hop nginx cuts at sixty. So the wire gets less.
 *
 * 🚨 THE HONESTY RULE FOR THE SECOND CUT: `originalBytes` stays the size of
 * the output BEFORE ANY truncation — the number exec/audit.ts measured off
 * the real command — and `truncated` is the OR of both cuts. Recomputing
 * originalBytes here would report the 20 KB stored copy as the whole of a
 * 4 MB log, which is the plausible-zero move: a reader would think they were
 * looking at everything.
 */
const WIRE_OUTPUT_BYTES = 4_000;

function projectOutput(t: TruncatedText | undefined): WardenTruncatedText {
  // A record written by an older daemon, or one hand-edited on the box, may
  // not carry this at all. An absent output is empty and says so; it is
  // never invented and never read as "the command printed nothing".
  if (!t || typeof t.text !== 'string') return { text: '', truncated: false, originalBytes: 0 };
  const cut = truncateOutput(t.text, WIRE_OUTPUT_BYTES);
  return {
    text: cut.text,
    truncated: Boolean(t.truncated) || cut.truncated,
    originalBytes: Number.isFinite(t.originalBytes) ? t.originalBytes : cut.originalBytes,
  };
}

/**
 * One stored audit record as the operator may read it.
 *
 * Returns null where the backend would drop it, for the same reason
 * projectMessage does: the far side normalises by DROPPING, silently. A run
 * that happened and then failed to arrive is the one record whose absence
 * matters most, so it is dropped HERE, where the daemon can count it.
 *
 * ⚠️ NOTHING HERE RE-REDACTS, AND NOTHING HERE MAY UNDO REDACTION.
 * exec/audit.ts redacted at capture, BEFORE truncating, so a secret cannot
 * sit across a cut boundary. `redactions` names what fired. This function
 * only narrows.
 *
 * 🚨 THE ATTRIBUTION FIELDS ARE NEVER COERCED — THE RECORD IS DROPPED. Both
 * of them used to fall through a ternary to the STRONGER claim: an
 * unreadable `trigger` became 'operator_approved' and an unreadable
 * `operation.kind` became 'approved_command', i.e. "a human read this exact
 * command and approved it running on the production box". Nothing validates
 * these on the way in — store.ts load() casts the stored array through as
 * `Array.isArray(parsed.audit) ? parsed.audit : []` — so a hand-edited
 * state.json, or a record written by a daemon that spelled the field
 * differently, would have printed an UNATTENDED run in the operator's audit
 * page as one they signed off. That also disarmed the backend's own rule:
 * warden.service.ts normaliseAuditEntry() drops a record whose trigger it
 * cannot name, and it can never fire against a value this side already
 * turned into a valid literal.
 *
 * A missing record is a gap somebody has to go and explain. A coerced one is
 * a manufactured alibi nobody will ever question. Same choice, for the same
 * reason, as RECHECK_RESULTS below.
 *
 * ⚠️ AND THE GAP IS COUNTED ON THE WIRE, WHICH IT WAS NOT WHEN THIS DROP
 * SHIPPED. core.ts audit() tallies these nulls and raises onError — but
 * onError writes to the daemon's pm2 stdout, and `WardenAuditView` carried
 * `entries` and `truncated` and nothing else. So the Desk received a shorter
 * list beside `truncated: false` and said nothing, and the only reader who
 * could see the refusal was one already SSH-ed in running `pm2 logs warden`.
 * The tally now rides on `WardenAuditView.dropped`, and the backend adds its
 * own refusals to it and reports one total. (That total is on the API only —
 * no Desk surface fetches the audit route yet.) If you add another
 * reason to return null here, it must land in that count too — a drop this
 * function makes silently is the plausible-zero the whole file exists to
 * refuse.
 */
export function projectAudit(r: WardenAuditRecord): WardenAuditEntry | null {
  const id = text(r?.id, MAX_ID);
  if (!id) return null;
  if (!isParseableDate(r?.at)) return null;
  const trigger = r?.trigger === 'unattended' || r?.trigger === 'operator_approved' ? r.trigger : null;
  if (!trigger) return null;
  const operationKind =
    r.operation?.kind === 'safe_list' || r.operation?.kind === 'approved_command' ? r.operation.kind : null;
  if (!operationKind) return null;
  // The proposal id is a link target on the far side. An id outside the URL
  // charset is a link that cannot be followed — but unlike a chat message,
  // the RUN is the record and it must still be readable, so the field is
  // blanked rather than the whole entry dropped.
  const proposalId = typeof r.proposalId === 'string' && WARDEN_ID_RE.test(r.proposalId) ? r.proposalId : '';

  return {
    id,
    proposalId,
    at: r.at,
    finishedAt: isParseableDate(r.finishedAt) ? r.finishedAt : r.at,
    durationMs: Number.isFinite(r.durationMs) ? r.durationMs : 0,
    trigger,
    operatorId: typeof r.operatorId === 'string' ? text(r.operatorId, MAX_ID) : null,
    operationKind,
    operationName: typeof r.operation?.name === 'string' ? text(r.operation.name, MAX_ID) : null,
    command: text(r.command, MAX_COMMAND),
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    timedOut: Boolean(r.timedOut),
    stdout: projectOutput(r.stdout),
    stderr: projectOutput(r.stderr),
    // ⚠️ ALWAYS AN ARRAY, EMPTY WHEN NOTHING FIRED. Same discipline as the
    // record itself: the absence of a redaction must be a stated absence, or
    // a reader cannot tell "nothing was secret" from "redaction never ran".
    redactions: Array.isArray(r.redactions) ? r.redactions.map((x) => text(x, 100)).filter(Boolean) : [],
    recheck:
      r.recheck && isParseableDate(r.recheck.at) && RECHECK_RESULTS.has(r.recheck.result)
        ? { at: r.recheck.at, result: r.recheck.result, note: text(r.recheck.note, MAX_TEXT) }
        : null,
  };
}

/** ⚠️ `null` recheck means NOBODY LOOKED. It is not in this set on purpose —
 *  an unrecognised result collapses to null ("not re-checked") rather than to
 *  'unknown' ("re-checked, could not tell"), because claiming a re-check that
 *  did not happen is the worse of the two lies. */
const RECHECK_RESULTS: ReadonlySet<string> = new Set(['ok', 'still-bad', 'unknown']);
