// warden/src/diagnose/types.ts
//
// The shapes the DIAGNOSIS step consumes and produces. It consumes MEASURED
// FACTS (never a model's idea of a fact) and produces DATA (never a command
// anything in this package will execute on its own).
//
// ⚠️ NOTHING IN THIS DIRECTORY MAY EXECUTE ANYTHING. The diagnosis layer's
// entire output is a set of records for the store and the Desk to render;
// running one is src/exec/'s job, reached only from the daemon's own approval
// or sweep loop with a validated safe-list pick or an operator-approved
// string. diagnose.test.ts asserts structurally that no file here reaches
// child_process or either executor entry point — if that test ever fails, the
// failure IS the bug, not the test.

import type { CheckResult, Evidence } from '../types.js';
import type { ExecutableProposal, WardenAuditRecord } from '../exec/index.js';

// ── what the checks engine hands us ─────────────────────────────────────
//
// Derived from the engine's own CheckResult rather than re-declared, so a
// rename on that side is a compile error here rather than a field this layer
// quietly stops reading. Only the fields the prompt actually renders are
// required: the engine hands over a full CheckResult and the extra fields ride
// along unread, while a test can build a four-field literal.

export type DiagnosedCheck = Pick<CheckResult, 'id' | 'title' | 'status' | 'verdict'> &
  Partial<Pick<CheckResult, 'evidence' | 'reason' | 'standing' | 'gateKey' | 'measuredAt' | 'fresh'>>;

export type { CheckResult, Evidence };

// ── what a diagnosis turn is given ──────────────────────────────────────

export interface OpenProposalSummary {
  id: string;
  headline: string;
  status: string;
}

export interface DiagnosisInput {
  checks: readonly DiagnosedCheck[];
  /**
   * The operator's own standing instructions, in their own words ("never raise
   * the VerifyNow credit balance again", "leave the overnight retries alone").
   * These ARE instructions — the only text in the whole request that is — and
   * they are echoed back every sweep so a decision made once is honoured
   * later. They still cannot widen what may run: the operation menu comes from
   * SAFE_LIST and every pick goes through that operation's own validate(),
   * whatever an instruction says.
   */
  standingInstructions?: readonly string[];
  /** What the operator just typed, on a POST /chat turn. Null on a sweep. */
  operatorMessage?: string | null;
  /** Already-open proposals, so a sweep does not raise the same fault twice. */
  openProposals?: readonly OpenProposalSummary[];
  /** Injectable clock — tests pin it; production omits it. */
  now?: Date;
}

// ── what a diagnosis turn produces ──────────────────────────────────────
//
// Wire-shaped, but NOT the wire type. `WardenProposal`/`WardenChatMessage`
// live in backend/src/desk/warden.types.ts, which this package has no import
// path into (same reason fence.ts ports sanitizePromptValue by hand). The
// field names and the enum spellings below are that contract, mirrored
// deliberately:
//
//   🚨 A PROPOSAL's red-gate kind is `red_gate` (UNDERSCORE).
//   🚨 A MESSAGE's  red-gate kind is `red-gate` (HYPHEN).
//
// They are spelled differently on purpose and each is exact-matched on the far
// side. Getting one wrong does not error anywhere — the backend's normaliser
// drops the whole record and it simply never appears in the thread.
// WARDEN_MESSAGE_KINDS below is frontend/components/desk/chat.tsx's KIND_TAG
// union verbatim; a seventh kind invented here renders as nothing.

export const WARDEN_MESSAGE_KINDS = ['finding', 'fixed', 'red-gate', 'proposal', 'ran', 'note'] as const;
export type WardenMessageKind = (typeof WARDEN_MESSAGE_KINDS)[number];

export type DraftedProposalKind = 'proposal' | 'red_gate';

/** Mirror of warden.service.ts's PROPOSAL_ID_RE. An id outside this charset is
 *  rejected by the backend BEFORE it ever calls the daemon (the id lands in a
 *  URL path), so a proposal carrying one is unreachable for approve and
 *  decline while still sitting on the board looking actionable. */
export const PROPOSAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface DraftedProposal {
  id: string;
  kind: DraftedProposalKind;
  status: 'pending';
  headline: string;
  diagnosis: string;
  /**
   * EXACTLY what approving this will run, as it will run. For a safe-list pick
   * this is `BuiltOperation.describe` — derived from the validated args by the
   * same code that executes them, so it cannot drift from what runs. For a
   * command outside the list it is the literal string a human will read in the
   * money-grade confirm and echo back as `expectedCommand`.
   *
   * ALWAYS null for kind 'red_gate' — rule 6. Made unrepresentable upstream:
   * parse.ts's red-gate variant has no command field at all, so this is not a
   * value that gets nulled, it is a value that never exists.
   */
  command: string | null;
  gateKey: string | null;
  raisedAt: string;

  // ── daemon-internal, never on the wire ────────────────────────────────
  /**
   * The VALIDATED safe-list pick behind this proposal, if it is one. Approve
   * re-runs it by NAME + ARGS — the executor re-derives the command from the
   * operation and catches drift in the safe list itself. `command` is display
   * text for a human, not an input to anything.
   */
  operation: { name: string; args: Record<string, string | number | boolean> } | null;
  /** For a safe-list pick this is the LIST's own claim, not the model's. */
  reversible: boolean;
  /** The check ids this was diagnosed from, so a re-check knows what to
   *  re-measure — "ran · re-checked" needs to know what to look at again. */
  checkIds: string[];
}

/**
 * COMPILE-TIME ONLY. A drafted proposal must be executable exactly as drafted:
 * the executor's approve path reads `id`, `kind`, `status`, `command` and
 * `operation` off the stored proposal, and if this layer's shape drifts from
 * what it reads, the failure would surface as an operator clicking Approve on
 * something that cannot run. Erased at build time (both imports are type-only)
 * — it costs nothing at runtime and fails loudly at the only moment it can
 * still be cheap to fix.
 */
const _draftedProposalIsExecutable = (p: DraftedProposal): ExecutableProposal => p;
void _draftedProposalIsExecutable;

export interface DraftedMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenMessageKind;
  at: string;
  /** Paragraphs. Prose, not markdown — the Desk renders text nodes. */
  body: string[];
  pre?: { tone: 'inset' | 'ground'; lines: string[] };
  proposalId?: string;
  footnote?: string;
}

/** One drafted item the diagnosis layer threw away, and why. Surfaced to the
 *  operator as a 'note' rather than swallowed: a model that keeps producing
 *  refused output is itself a fault worth seeing. Never carries the refused
 *  content — a refused command must not reach the thread by the back door. */
export interface Refusal {
  /** Index in the model's own items array, so a log line can be correlated. */
  index: number;
  reason: string;
}

export interface DiagnosisResult {
  proposals: DraftedProposal[];
  messages: DraftedMessage[];
  refusals: Refusal[];
  /** Model id actually used, or null when no model ran (no key / call failed). */
  model: string | null;
  /** Set when the whole reply was refused or the call never happened. */
  failure: string | null;
}

/** A re-check the sweep loop attaches to an audit record after a fix ran —
 *  "ran · re-checked". Re-exported here because the diagnosis layer writes the
 *  message that reports it. */
export type WardenRecheck = WardenAuditRecord['recheck'];
