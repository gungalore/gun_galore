// warden/src/exec/executor.ts
//
// THE EXECUTOR — the only code in this daemon that causes anything to run.
// Exactly two entry points, matching the only two things that are allowed to
// run at all:
//
//   runSafeListOperation()  — a SAFE_LIST operation, by name plus arguments
//                             that operation's own validate() accepted. May run
//                             with NO human in the loop.
//   runApprovedProposal()   — anything else. Only reachable after an operator
//                             read the EXACT command in the Desk's money-grade
//                             confirm and approved it, and only if the command
//                             still matches, byte for byte, what they read.
//
// There is no third path, and there is no way to reach a shell that does not go
// through one of them.
//
// ⚠️ CLAUDE'S OUTPUT NEVER ARRIVES HERE AS A COMMAND. The diagnosis layer parses
// the model's reply into a strict shape — {operation:{name,args}} for a
// safe-list pick, {shellCommand} for anything else, {red_gate} for "no fix
// exists". A picked `name` is looked up in SAFE_LIST by exact match and its
// `args` go through THAT operation's own validate(); a `shellCommand` is not
// executed from that shape at all — it becomes a stored proposal's `command`
// field, which is text a human reads. So the worst a poisoned fact can achieve
// is steering Warden into the wrong (still safe-list-bounded) operation, or
// drafting a misleading proposal a human still has to read and approve. There
// is no code path from a model's tokens to an argv that skips validate().
//
// ⚠️ NEVER AWAIT A RUN INSIDE AN HTTP HANDLER. nginx cuts at 60s and Cloudflare
// at 100s; the backend's own write budget is 25s and it has already spent part
// of that on its pre-approve GET. rerunBackup alone is budgeted ten minutes.
// Handlers call these functions, hand the promise to the daemon's background
// loop, and answer immediately with a "started" message; the outcome lands in
// the thread on a later poll. A handler that awaits a run turns a working fix
// into a false 503 while the command keeps running unattended — the exact
// failure the confirm dialog exists to prevent.

import { randomUUID } from 'node:crypto';
import { prepareOutput, type WardenAuditRecord } from './audit.js';
import { describePlan, runPlan as defaultRunPlan, type ExecPlan, type RunOutcome } from './proc.js';
import { findSafeListOperation, type BuiltOperation } from './safe-list.js';

/**
 * The subset of a stored proposal the executor needs. Structurally a superset
 * of WardenProposal (backend/src/desk/warden.types.ts) minus the presentation
 * fields — `operation` is Warden's own and the backend ignores unknown keys.
 */
export interface ExecutableProposal {
  id: string;
  kind: 'proposal' | 'red_gate';
  status: 'pending' | 'approved' | 'declined' | 'acknowledged';
  /** Exactly the string the Desk showed. Null for a red gate. */
  command: string | null;
  /** Set when the fix is a safe-list operation rather than a raw command. Its
   *  presence is what lets approve re-derive the command from the operation and
   *  catch drift in the safe list itself. */
  operation: { name: string; args: unknown } | null;
}

export type RefusalCode =
  | 'unknown-operation'
  | 'invalid-arguments'
  | 'cooling-down'
  | 'red-gate'
  | 'not-pending'
  | 'no-command'
  | 'command-changed'
  | 'no-operator'
  | 'obviously-destructive';

export type ExecutionOutcome =
  | { ok: true; record: WardenAuditRecord }
  | { ok: false; code: RefusalCode; reason: string };

/** Injected so tests can drive the executor without spawning anything, and so
 *  the daemon's loop can supply a clock. Production uses the defaults. */
export interface ExecRuntime {
  runPlan: (plan: ExecPlan) => Promise<RunOutcome>;
  now: () => Date;
  newId: () => string;
  /** Keyed `name:JSON(resolved args)`, so two different logIds cool down
   *  independently. In memory and reset by a daemon restart, which is fine:
   *  this damps retries, it is not a lock. */
  cooldowns: Map<string, number>;
}

export function createRuntime(overrides: Partial<ExecRuntime> = {}): ExecRuntime {
  return {
    runPlan: defaultRunPlan,
    now: () => new Date(),
    newId: () => `aud_${randomUUID()}`,
    cooldowns: new Map(),
    ...overrides,
  };
}

const defaultRuntime = createRuntime();

export interface ExecutionRequest {
  proposalId: string;
  /** Non-null only when a human approved this run. It is what flips the audit
   *  record's trigger to `operator_approved`. */
  operatorId: string | null;
}

// ── entry point 1: the safe list ────────────────────────────────────────────

export async function runSafeListOperation(
  name: unknown,
  rawArgs: unknown,
  req: ExecutionRequest,
  runtime: ExecRuntime = defaultRuntime,
): Promise<ExecutionOutcome> {
  const op = findSafeListOperation(name);
  if (!op) {
    return { ok: false, code: 'unknown-operation', reason: `"${String(name)}" is not on the safe list.` };
  }

  const validated = op.validate(rawArgs);
  if (!validated.ok) {
    return { ok: false, code: 'invalid-arguments', reason: `${op.name}: ${validated.error}` };
  }

  // A run a human personally approved skips the cooldown. The cooldown exists
  // to stop a flapping condition re-firing its own fix in a loop; an operator
  // who read the command and clicked Approve has already made that judgement,
  // and refusing them would look like the daemon silently ignoring them.
  const attended = !!req.operatorId;
  const key = `${op.name}:${JSON.stringify(validated.args)}`;
  const last = runtime.cooldowns.get(key);
  const elapsed = last === undefined ? Infinity : runtime.now().getTime() - last;
  if (!attended && elapsed < op.cooldownMs) {
    const waitS = Math.ceil((op.cooldownMs - elapsed) / 1000);
    return {
      ok: false,
      code: 'cooling-down',
      reason: `${op.name} ran ${Math.floor(elapsed / 1000)}s ago; its cooldown is ${Math.floor(op.cooldownMs / 1000)}s — ${waitS}s left.`,
    };
  }
  // ⚠️ Claim the slot BEFORE running, never after. run() awaits a real
  // subprocess — rerunBackup is budgeted ten minutes — so a timestamp written
  // only on completion lets two triggers that land close together (a sweep
  // re-firing, or an operator approving the same fix a sweep just started) BOTH
  // see the cooldown as expired and both start, defeating it for exactly the
  // case it exists for. The cost is that a failed run also blocks a retry for
  // one window, which is acceptable for a courtesy rate limit.
  runtime.cooldowns.set(key, runtime.now().getTime());

  const record = await execute(op.build(validated.args), runtime, {
    trigger: attended ? 'operator_approved' : 'unattended',
    operatorId: req.operatorId,
    proposalId: req.proposalId,
    operation: { kind: 'safe_list', name: op.name, args: asScalarRecord(validated.args) },
  });
  return { ok: true, record };
}

// ── entry point 2: a command an operator read and approved ──────────────────

/**
 * ⚠️ THE COMPARE-AND-SWAP LIVES HERE TOO, not only in the Nest backend. The
 * backend re-reads the proposal and refuses on drift before it ever calls the
 * daemon, but that read and this call are two round trips with a gap between
 * them, and a daemon that trusted the caller to have checked would be trusting
 * a check it cannot see. `expectedCommand` is compared to the STORED command
 * byte for byte.
 *
 * ⚠️ NO NORMALISATION. Not trimmed, not whitespace-collapsed, not
 * case-folded. A command that differs by a space is a command the operator did
 * not read; treating it as equal is precisely how the money-grade confirm gets
 * defeated while still appearing to work.
 *
 * When the proposal names a safe-list operation, the command is ALSO re-derived
 * from that operation and its stored arguments and must match — so a change to
 * the safe list itself between raising and approving is caught, rather than
 * running today's code behind yesterday's description.
 */
export async function runApprovedProposal(
  proposal: ExecutableProposal,
  expectedCommand: string,
  operatorId: string,
  runtime: ExecRuntime = defaultRuntime,
): Promise<ExecutionOutcome> {
  if (typeof operatorId !== 'string' || operatorId.trim() === '') {
    return { ok: false, code: 'no-operator', reason: 'An approved run needs the operator who approved it — there is no unattended path here.' };
  }
  // Rule 6: a red gate has no command by construction. It cannot be approved,
  // and it must not be approvable by sending one.
  if (proposal.kind === 'red_gate') {
    return { ok: false, code: 'red-gate', reason: 'A red gate has no command to run — it needs a commit or a config change.' };
  }
  if (proposal.status !== 'pending') {
    return { ok: false, code: 'not-pending', reason: `That proposal is already ${proposal.status}.` };
  }
  const stored = proposal.command;
  if (typeof stored !== 'string' || stored === '') {
    return { ok: false, code: 'no-command', reason: 'That proposal no longer holds a command.' };
  }

  if (proposal.operation) {
    const op = findSafeListOperation(proposal.operation.name);
    if (!op) {
      return { ok: false, code: 'unknown-operation', reason: `"${String(proposal.operation.name)}" is no longer on the safe list.` };
    }
    const validated = op.validate(proposal.operation.args);
    if (!validated.ok) {
      return { ok: false, code: 'invalid-arguments', reason: `${op.name}: ${validated.error}` };
    }
    const rebuilt = op.build(validated.args);
    if (rebuilt.describe !== stored) {
      return {
        ok: false,
        code: 'command-changed',
        reason: 'The safe-list operation no longer produces the command that was raised — re-check before approving.',
      };
    }
    if (stored !== expectedCommand) {
      return { ok: false, code: 'command-changed', reason: 'That command changed since you opened it.' };
    }
    const record = await execute(rebuilt, runtime, {
      trigger: 'operator_approved',
      operatorId,
      proposalId: proposal.id,
      operation: { kind: 'safe_list', name: op.name, args: asScalarRecord(validated.args) },
    });
    return { ok: true, record };
  }

  if (stored !== expectedCommand) {
    return { ok: false, code: 'command-changed', reason: 'That command changed since you opened it.' };
  }
  // Insurance, not the control. What makes this path safe is that a human read
  // this exact string; the denylist only catches a misdiagnosis that drafted
  // something catastrophic-looking, and it is trivially bypassable with intent.
  // It runs again here because a proposal can outlive the draft-time check.
  const destructive = assertNotObviouslyDestructive(stored);
  if (!destructive.ok) {
    return { ok: false, code: 'obviously-destructive', reason: `Refused: the command matches ${destructive.matched}. Run it by hand if it is genuinely what you want.` };
  }

  // The one place a real shell runs, and the string reaches it as a single argv
  // element — there is no second interpolation between what the operator read
  // and what sh receives.
  const plan: ExecPlan = { kind: 'shell', command: stored, timeoutMs: 5 * 60_000 };
  const record = await execute({ plan, describe: describePlan(plan) }, runtime, {
    trigger: 'operator_approved',
    operatorId,
    proposalId: proposal.id,
    operation: { kind: 'approved_command', name: null, args: null },
  });
  return { ok: true, record };
}

// ── the one place a WardenAuditRecord is assembled ──────────────────────────

async function execute(
  op: BuiltOperation,
  runtime: ExecRuntime,
  meta: {
    trigger: WardenAuditRecord['trigger'];
    operatorId: string | null;
    proposalId: string;
    operation: WardenAuditRecord['operation'];
  },
): Promise<WardenAuditRecord> {
  const startedAt = runtime.now();
  // A plan that throws (a node plan hitting an unexpected fs error) must still
  // produce a record — an execution with no audit row is the one outcome this
  // module may never produce.
  const result = await runtime.runPlan(op.plan).catch(
    (err: unknown): RunOutcome => ({
      exitCode: null,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      timedOut: false,
    }),
  );
  const finishedAt = runtime.now();

  const stdout = prepareOutput(result.stdout);
  const stderr = prepareOutput(result.stderr);

  return {
    id: runtime.newId(),
    at: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    trigger: meta.trigger,
    operatorId: meta.operatorId,
    proposalId: meta.proposalId,
    operation: meta.operation,
    command: op.describe,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: { text: stdout.text, truncated: stdout.truncated, originalBytes: stdout.originalBytes },
    stderr: { text: stderr.text, truncated: stderr.truncated, originalBytes: stderr.originalBytes },
    redactions: [...new Set([...stdout.redactions, ...stderr.redactions])],
    recheck: null, // the sweep loop fills this in if and when it re-measures
  };
}

/** Only scalars, and only own enumerable keys — the audit row records what ran,
 *  and a nested object would invite someone to read structure back out of it. */
function asScalarRecord(v: unknown): Record<string, string | number | boolean> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[k] = val;
  }
  return out;
}

// ── draft-time denylist ─────────────────────────────────────────────────────
//
// Runs when the diagnosis layer FIRST drafts a command outside the safe list,
// before it is stored or shown, and again at approve time. A hit turns the
// proposal into a red gate ("handle this by hand") instead of surfacing an
// Approve button. ⚠️ This is NOT what makes the approved-command path safe — a
// human reading the string is. It is insurance against a misdiagnosis drafting
// something catastrophic-looking that a rushed operator might wave through, and
// it is easy to evade on purpose. Never cite it as a control.
const OBVIOUSLY_DESTRUCTIVE: ReadonlyArray<RegExp> = [
  // `rm` whose TARGET is the root, whatever order or spelling the flags take
  // (-rf, -fr, -r -f, --no-preserve-root). Matching on the target rather than
  // the flags is what keeps `rm -rf …/.next/cache` — a real, safe fix — out of
  // the net.
  /\brm\b(\s+-{1,2}[A-Za-z][A-Za-z-]*)*\s+\/(\*|\s|$)/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^\n]*\bof=\/dev\//,
  /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/,
  /\b(useradd|userdel|passwd|visudo|chpasswd)\b/,
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/,
  /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  // Rotating a secret is never a command Warden drafts. ID_HASH_SECRET in
  // particular makes every stored KYC file permanently undecryptable.
  /\bID_HASH_SECRET\s*=/,
  /\bgit\s+(push|reset|checkout|merge|pull)\b/,
  /\bprisma\s+migrate\b/,
];

export function assertNotObviouslyDestructive(command: string): { ok: true } | { ok: false; matched: string } {
  for (const re of OBVIOUSLY_DESTRUCTIVE) {
    if (re.test(command)) return { ok: false, matched: re.source };
  }
  return { ok: true };
}
