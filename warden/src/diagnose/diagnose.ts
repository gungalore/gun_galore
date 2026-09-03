// warden/src/diagnose/diagnose.ts
//
// THE DIAGNOSIS STEP, end to end: measured facts in, validated records out.
//
//   facts (already measured, by fixed code)
//     → prompt.ts        fenced as data, with the operation menu rendered
//                        from SAFE_LIST itself
//     → client.ts        one Claude call, key from env, never logged
//     → parse.ts         strict validation; refuse, don't coerce
//     → here             ids, timestamps, and the thread messages that carry
//                        them
//
// The output is DATA. Nothing in this file, or anything it calls, executes a
// command: a safe-list proposal carries the operation NAME and its VALIDATED
// ARGS so the approval loop can re-run it through runSafeListOperation, and a
// command outside the list is a string an operator must read first. That is
// why a hostile line in an nginx log can, at worst, produce a wrong diagnosis
// a human rejects — never an unattended command.
//
// WHAT THIS FILE DELIBERATELY DOES NOT WRITE: 'finding', 'fixed' and 'ran'
// messages. Those belong to the sweep loop and the approval loop, which hold
// the measurements and the audit records respectively — a 'ran' message
// written from here would have to invent a transcript it never saw.

import { randomUUID } from 'node:crypto';
import type { ModelCaller } from './client.js';
import { parseDiagnosisReply, type ValidatedItem } from './parse.js';
import {
  PROPOSAL_ID_RE,
  type DiagnosedCheck,
  type DiagnosisInput,
  type DiagnosisResult,
  type DraftedMessage,
  type DraftedProposal,
  type Refusal,
} from './types.js';

/**
 * Stable, not random, so a sweep that finds the same standing config fault
 * every ten minutes updates one red gate instead of minting a new one each
 * time. A red gate cannot be approved, declined or dismissed — only the gate
 * changing clears it — so an accumulating pile of identical ones would be
 * unclearable noise on the operator's board.
 */
const MODEL_UNAVAILABLE_ID = 'redgate_model_unavailable';

/** Wire cap: 12 paragraphs per message, anything past it is dropped by the
 *  backend's normaliser. Split here so the cut is ours and visible. */
const MAX_PARAGRAPHS = 12;

export interface DiagnoseOptions {
  /** Injected for tests and for a daemon that wants a scripted model. When
   *  null, no model is configured — see modelUnavailable() below. */
  caller: ModelCaller | null;
}

export async function diagnose(input: DiagnosisInput, opts: DiagnoseOptions): Promise<DiagnosisResult> {
  const at = (input.now ?? new Date()).toISOString();

  if (!opts.caller) return modelUnavailable(at);

  const reply = await opts.caller(input);
  if (!reply.ok) {
    // A failed call is NOT a red gate. A red gate is a standing fact that
    // only a commit or a config change clears; a timeout or a 529 clears
    // itself on the next sweep, and minting an unclearable board item for a
    // transient failure is how a board stops being read. It is still said out
    // loud — silence after a failed call is indistinguishable from a healthy
    // box, which is the failure mode this whole daemon exists to refuse.
    return {
      proposals: [],
      messages: [
        note(at, [
          'I could not reach Claude for this sweep, so nothing below was diagnosed. The checks themselves still ran and their results stand.',
          `The call failed with: ${reply.reason}`,
        ]),
      ],
      refusals: [],
      model: null,
      failure: reply.reason,
    };
  }

  const parsed = parseDiagnosisReply(reply.text);
  if (!parsed.ok) {
    // REFUSED WHOLE, NOT SALVAGED. There is no partial reading of a reply
    // whose shape we do not recognise — guessing at what a model meant is the
    // step where a poisoned fact would get its foothold.
    return {
      proposals: [],
      messages: [
        note(at, [
          'Claude answered this sweep in a shape I do not accept, so I threw the whole reply away rather than guess at what it meant. Nothing was proposed and nothing ran.',
          `What was wrong: ${parsed.reason}`,
        ]),
      ],
      refusals: [],
      model: reply.model,
      failure: `refused the model reply: ${parsed.reason}`,
    };
  }

  const standing = standingChecks(input.checks);
  const proposals: DraftedProposal[] = [];
  const messages: DraftedMessage[] = [];

  for (const parsedItem of parsed.items) {
    const item = enforceStanding(parsedItem, standing);
    const proposal = toProposal(item, at);
    proposals.push(proposal);
    messages.push(toMessage(item, proposal, at));
  }

  if (parsed.refusals.length > 0) messages.push(refusalNote(parsed.refusals, at));

  return { proposals, messages, refusals: parsed.refusals, model: reply.model, failure: null };
}

// ── the standing rule, enforced rather than requested ───────────────────
//
// The checks engine marks a result `standing` when NO command Warden runs can
// clear it — the CIP-sheets backup gap is the canonical one: only a human
// editing infra/backup/backup.sh resolves it, and a tar Warden ran on its own
// outside that reviewed script would be a worse answer than the gap. The
// prompt says so; this enforces it.
//
// ⚠️ A RULE THAT LIVES ONLY IN A PROMPT IS A RULE AN INJECTED FACT CAN TALK
// THE MODEL OUT OF. This is the same discipline as the operation menu being
// generated from the validators: the model is told, and then it does not
// matter whether it listened.

function standingChecks(checks: readonly DiagnosedCheck[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const c of checks) if (c.standing) out.set(c.id, c.gateKey ?? null);
  return out;
}

/**
 * ANY cited standing check downgrades the whole item, not all of them: the
 * model is asked for one item per distinct fault, so an item that names a
 * standing fact at all is about that fact, and a fix offered against it would
 * be a button that cannot do what it says.
 */
function enforceStanding(item: ValidatedItem, standing: Map<string, string | null>): ValidatedItem {
  if (item.kind === 'red_gate') return item;
  const cited = item.checkIds.find((id) => standing.has(id));
  if (cited === undefined) return item;

  return {
    kind: 'red_gate',
    headline: item.headline,
    diagnosis:
      `${item.diagnosis}\n\nWarden drafted a fix for this and then withheld it: check "${cited}" is a standing fact, which no command it runs can clear. It needs a change a person makes.`.slice(
        0,
        4_000,
      ),
    gateKey: item.gateKey ?? standing.get(cited) ?? null,
    checkIds: item.checkIds,
  };
}

// ── records ─────────────────────────────────────────────────────────────

function toProposal(item: ValidatedItem, at: string): DraftedProposal {
  const base = {
    id: newProposalId(),
    status: 'pending' as const,
    headline: item.headline,
    diagnosis: item.diagnosis,
    gateKey: item.gateKey,
    raisedAt: at,
    checkIds: item.checkIds,
  };

  if (item.kind === 'red_gate') {
    // Rule 6, restated at the last point it could be got wrong: a red gate
    // has no command. `null` here is not a cleared field — parse.ts's
    // red-gate variant has no command to clear.
    return { ...base, kind: 'red_gate', command: null, operation: null, reversible: false };
  }

  return {
    ...base,
    kind: 'proposal',
    command: item.command,
    operation: item.operation,
    reversible: item.reversible,
  };
}

function toMessage(item: ValidatedItem, proposal: DraftedProposal, at: string): DraftedMessage {
  if (item.kind === 'red_gate') {
    return {
      id: newMessageId(),
      role: 'warden',
      // 🚨 HYPHEN. The message kind is 'red-gate'; the proposal kind above is
      // 'red_gate'. Both are exact-matched on the far side and neither is
      // corrected — a message with the wrong one is dropped silently and the
      // fault simply never appears in the thread.
      kind: 'red-gate',
      at,
      body: paragraphs(item.diagnosis, item.headline),
      proposalId: proposal.id,
    };
  }

  return {
    id: newMessageId(),
    role: 'warden',
    kind: 'proposal',
    at,
    body: paragraphs(item.diagnosis, item.headline),
    // `inset` is the tone for "what WOULD happen" — a command that has not
    // run. 'ground' is reserved for a real transcript and is written by the
    // approval loop from an audit record, never from here.
    pre: { tone: 'inset', lines: [proposal.command ?? ''] },
    proposalId: proposal.id,
    footnote: item.reversible ? 'Reversible.' : 'Not reversible.',
  };
}

function note(at: string, body: string[]): DraftedMessage {
  return { id: newMessageId(), role: 'warden', kind: 'note', at, body };
}

function refusalNote(refusals: Refusal[], at: string): DraftedMessage {
  return {
    id: newMessageId(),
    role: 'warden',
    kind: 'note',
    at,
    body: [
      `I threw away ${refusals.length} thing${refusals.length === 1 ? '' : 's'} Claude proposed this sweep because ${refusals.length === 1 ? 'it did' : 'they did'} not validate. Nothing from ${refusals.length === 1 ? 'it' : 'them'} reached the board.`,
    ],
    // The reasons, not the refused content — a refused command must not
    // reach the thread by the back door.
    pre: { tone: 'inset', lines: refusals.map((r) => `item ${r.index}: ${r.reason}`) },
  };
}

/**
 * No ANTHROPIC_API_KEY. This IS a red gate: it needs a credential put on the
 * box, which is a human action with no command Warden could run, and it
 * persists until someone does it. Named as itself rather than reported as
 * "no faults found" — the failure this design refuses is a plausible silence
 * standing in for a measurement nobody took.
 */
function modelUnavailable(at: string): DiagnosisResult {
  const proposal: DraftedProposal = {
    id: MODEL_UNAVAILABLE_ID,
    kind: 'red_gate',
    status: 'pending',
    headline: 'Warden cannot diagnose anything: ANTHROPIC_API_KEY is not set on this box.',
    diagnosis:
      'The checks still ran and their numbers stand, but nothing turned them into findings, because the diagnosis step has no credential to call Claude with. Until ANTHROPIC_API_KEY is set in the environment this daemon starts under, treat an empty board as "nobody looked", not as "nothing is wrong". There is no command for this — it is a credential on the box.',
    command: null,
    gateKey: 'ANTHROPIC_API_KEY',
    raisedAt: at,
    operation: null,
    reversible: false,
    checkIds: [],
  };

  return {
    proposals: [proposal],
    messages: [
      {
        id: newMessageId(),
        role: 'warden',
        kind: 'red-gate',
        at,
        body: [proposal.diagnosis],
        proposalId: proposal.id,
      },
    ],
    refusals: [],
    model: null,
    failure: 'ANTHROPIC_API_KEY is not set',
  };
}

// ── ids and prose ───────────────────────────────────────────────────────

/**
 * randomUUID is already inside PROPOSAL_ID_RE's charset and well under 64
 * characters, so the strip below never fires today. It stays because a
 * proposal id that falls outside that regex is not a cosmetic problem: the
 * backend validates it before it ever calls this daemon, so the proposal
 * becomes unreachable for approve and decline while still sitting on the
 * board looking actionable. Cheap guard, expensive failure.
 */
function newProposalId(): string {
  const id = `prop_${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return PROPOSAL_ID_RE.test(id) ? id : `prop_${Date.now()}`;
}

function newMessageId(): string {
  return `msg_${randomUUID()}`.slice(0, 64);
}

/** Prose into paragraphs. Never returns an empty array: a message whose body
 *  filters down to nothing is DROPPED WHOLE by the backend's normaliser, so a
 *  diagnosis that arrived as one blank line would vanish from the thread with
 *  no error anywhere. The headline is the fallback. */
function paragraphs(text: string, fallback: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS);
  return parts.length > 0 ? parts : [fallback];
}
