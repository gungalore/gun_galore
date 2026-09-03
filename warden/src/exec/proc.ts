// warden/src/exec/proc.ts
//
// THE ONE PLACE THE EXECUTION LAYER SPAWNS A CHILD PROCESS. Nothing under
// exec/ may import node:child_process except this file — grep before adding a
// second caller, because a second spawn site is a second place the safe list
// can be bypassed.
//
// ⚠️ KNOWN DRIFT, NOT A DESIGN: src/proc.ts is an earlier pass of this same
// module, and src/checks/ and src/types.ts import execFileP and RunOutcome
// from it. So the package still has TWO runners. That is tolerable only
// because the checks module runs fixed read-only measurement commands and
// never touches the safe list — but it should be consolidated onto this one,
// and until it is, "one spawn site" is true of exec/ and not of the package.
//
// The retired src/safety/ copy — an earlier pass of the safe list, executor,
// audit and prompt fence — is GONE (deleted with the redaction fix). It was
// unreachable from src/index.ts but exported names identical to the live
// ones (SAFE_LIST, runSafeListOperation, findSafeListOperation) while
// carrying a real prototype-chain hole its live twin does not have: it gated
// on `!(id in LOG_FILES)`, so 'constructor' and '__proto__' validated. One
// stray auto-import would have wired a live caller to it with no type error.
// Only its proc.ts survived, as src/proc.ts, because three live modules
// import it. Do not reintroduce a second copy of anything in exec/.
//
// Everything runs through an ExecPlan, and there are only three kinds:
//
//   argv  — execFile(file, argv[]). No `/bin/sh -c` anywhere in the path, so
//           there is no shell metacharacter (`;` `|` `` ` `` `$( )` `&&`) for
//           a validated argument to smuggle through, whatever it contains.
//           EVERY safe-list operation is one of these or a `node` plan.
//   node  — a narrow fs-only routine (archive-then-truncate, prune) that never
//           shells out at all.
//   shell — the ONE sanctioned exception: a command an operator personally
//           read in the Desk's money-grade confirm and approved, byte for
//           byte. ⚠️ LOAD-BEARING: only executor.runApprovedProposal() may
//           build one of these, and exec/safe-list.test.ts asserts that no
//           safe-list operation ever produces one.
//
// describePlan() derives the human-readable command string FROM the plan, so
// "the command you return must be the command you run" holds by construction
// rather than by a template string somebody has to remember to keep in sync.

import { execFile } from 'node:child_process';

export interface RunOutcome {
  /** null when the process never produced one (killed on timeout, ENOENT, …). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ExecPlan =
  | { kind: 'argv'; file: string; argv: string[]; timeoutMs: number; cwd?: string }
  | { kind: 'node'; describe: string; timeoutMs: number; run: () => Promise<RunOutcome> }
  | { kind: 'shell'; command: string; timeoutMs: number };

/** Bounded so one runaway command cannot exhaust the daemon's heap before the
 *  audit layer ever gets a chance to truncate its output. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Display quoting for describePlan() only. ⚠️ LOAD-BEARING: the result of this
 * is NEVER parsed back into arguments by anything — it exists so an operator
 * reading an audit row or a confirm dialog sees exactly which argv ran. Round
 * -tripping a describe string back into a command would reintroduce the shell
 * this whole module avoids.
 */
function quoteForDisplay(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.split("'").join(`'\''`)}'`;
}

export function describePlan(plan: ExecPlan): string {
  switch (plan.kind) {
    case 'argv':
      return [plan.file, ...plan.argv].map(quoteForDisplay).join(' ');
    case 'node':
      return plan.describe;
    case 'shell':
      return plan.command;
  }
}

export async function runPlan(plan: ExecPlan): Promise<RunOutcome> {
  if (plan.kind === 'node') return plan.run();
  const [file, argv] =
    plan.kind === 'argv'
      ? ([plan.file, plan.argv] as const)
      : // The sanctioned exception. The whole approved command is ONE argv
        // element — there is no second interpolation step here for anything
        // to sneak into between what the operator read and what sh receives.
        (['/bin/sh', ['-c', plan.command]] as const);

  return new Promise<RunOutcome>((resolve) => {
    execFile(
      file,
      [...argv],
      {
        timeout: plan.timeoutMs,
        cwd: plan.kind === 'argv' ? plan.cwd : undefined,
        maxBuffer: MAX_BUFFER_BYTES,
        killSignal: 'SIGTERM',
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null;
        // Node reports a timeout kill as `killed: true` with a signal and a
        // non-numeric `code`. A missing binary (ENOENT) also has a
        // non-numeric `code` but killed:false — the two must not be confused,
        // because "we cut it off" and "it was never there" read very
        // differently in an audit row.
        const timedOut = !!err && (err.killed === true || err.signal === 'SIGTERM') && typeof err.code !== 'number';
        const outText = stdout?.toString() ?? '';
        let errText = stderr?.toString() ?? '';
        if (!errText && err) {
          errText = timedOut ? `killed after ${plan.timeoutMs}ms (timeout)` : err.message;
        }
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: outText,
          stderr: errText,
          timedOut,
        });
      },
    );
  });
}
