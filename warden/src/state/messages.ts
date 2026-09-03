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
  type WardenMessageKind,
  type WardenProposal,
} from '../types.js';
import type { WardenAuditRecord } from '../exec/index.js';
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

export function fixedMessage(result: CheckResult, previous: CheckStatus | null, at: string): WardenChatMessage {
  const from = previous ? `was ${previous}, ` : '';
  return build({
    at,
    kind: 'fixed',
    body: [`${result.title} is back to ok — ${from}now: ${result.verdict}`],
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
