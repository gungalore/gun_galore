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
//   node  — a narrow routine written in this package rather than composed as a
//           command: archive-then-truncate, prune, and the psql plans below.
//           ⚠️ "fs-only, never shells out" is what this line USED to say and it
//           was already untrue when it was written — clearNextCache's node plan
//           calls runPlan() for `pm2 reload` after emptying the directory. The
//           narrow rule that does hold: a node plan never builds a command from
//           a string, so whatever it reaches for is an argv this file wrote.
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
  // ⚠️ THE INNER ESCAPE HAD NEVER ONCE RUN. It was written as a template
  // literal `'\''`, in which \' is just ' — so it produced ''' rather than the
  // POSIX '\'' form, and no test caught it because until the psql plans landed
  // NO safe-list argv contained a single quote. The nested literal below uses
  // \\' , which is a backslash followed by a quote. Display only, as the note
  // above says, so the bug cost nothing — but a reader checking a confirm
  // dialog against a shell would have found it did not paste.
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.split("'").join(`'\\''`)}'`;
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

// ── psql ────────────────────────────────────────────────────────────────────
//
// ⚠️ A SECOND execFile CALL SITE, IN THE ONE FILE THAT IS ALLOWED ONE, AND A
// KNOWN TWIN OF checks/context.ts's queryDb(). They are not shared, for two
// reasons that are worth stating rather than rediscovering: exec/ sits BELOW
// checks/ and may not import from it, and the two want different answers — the
// check layer wants parsed rows as an Attempt, the exec layer wants a
// RunOutcome with an exit code and stderr because every run has to become an
// audit row. If you change the connection handling here, change it there too.
//
// ⚠️ THE PASSWORD GOES THROUGH THE CHILD'S ENVIRONMENT, NEVER ARGV. Putting the
// connection string on the command line would print the password in `ps` for
// anyone on the box, which is the exact thing infra/backup/backup.sh goes out
// of its way to avoid. It is also why these are `node` plans and not `argv`
// ones: ExecPlan has no env channel, deliberately, so nothing can smuggle an
// environment into an ordinary argv plan.
//
// ⚠️ THE SQL IS NEVER COMPOSED FROM AN ARGUMENT. Every caller in safe-list.ts
// passes a string built at module scope from constants this repo wrote. There
// is no parameter channel here for the same reason CheckContext.queryDb has
// none: no legitimate caller needs one, and a channel that exists is a channel
// that gets used.

/** psql's flags, in one place so the command an operator READS in the audit row
 *  and the command that RUNS are built from the same array. -X ignores the
 *  box's psqlrc, -A -t -q give a bare unaligned answer, ON_ERROR_STOP=1 makes a
 *  failed statement a non-zero exit instead of a chatty success. */
const PSQL_ARGV: readonly string[] = ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c'];

/**
 * Run one fixed statement against the app database as Warden's own DATABASE_URL
 * user. Returns a RunOutcome like every other plan, including for the two ways
 * this fails before psql is ever reached — an unset or unparseable DATABASE_URL
 * comes back as exit code 1 with a reason, never as a throw and never as a
 * silent success, because "nothing matched" and "we never connected" must not
 * read the same in the thread.
 */
export async function runPsql(sql: string, timeoutMs: number): Promise<RunOutcome> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return { exitCode: 1, stdout: '', stderr: 'DATABASE_URL is not set in Warden’s environment', timedOut: false };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { exitCode: 1, stdout: '', stderr: 'DATABASE_URL is set but is not a parseable URL', timedOut: false };
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: decodeURIComponent(parsed.hostname),
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    PGCLIENTENCODING: 'UTF8',
    // Without this psql waits on the OS TCP timeout, which outlives the plan's
    // own budget and turns "Postgres is unreachable" into "the run timed out".
    PGCONNECT_TIMEOUT: '5',
  };

  return new Promise<RunOutcome>((resolve) => {
    execFile(
      'psql',
      [...PSQL_ARGV, sql],
      { env: childEnv, timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, killSignal: 'SIGTERM' },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null;
        const timedOut = !!err && (err.killed === true || err.signal === 'SIGTERM') && typeof err.code !== 'number';
        let errText = stderr?.toString() ?? '';
        if (!errText && err) errText = timedOut ? `killed after ${timeoutMs}ms (timeout)` : err.message;
        resolve({
          // psql's own failure text ("connection refused", "password
          // authentication failed for user X") is safe to surface: the password
          // is not in it, because it never reached argv.
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: stdout?.toString() ?? '',
          stderr: errText,
          timedOut,
        });
      },
    );
  });
}

/**
 * Wrap one fixed statement as a plan.
 *
 * ⚠️ The describe string is derived by running describePlan() over the argv psql
 * ACTUALLY receives, so the sentence in the audit row and the confirm dialog
 * cannot drift from the statement that runs — the same property built() gives
 * every argv operation. It is a `node` plan only because of the environment;
 * everything else about it behaves like an argv one.
 *
 * ⚠️ THE COST, NAMED: a statement full of SQL string literals comes out
 * peppered with POSIX '\'' escapes and is harder to read than the statement
 * itself. That is deliberately not traded away for a prettier hand-built
 * string. What the escaping buys is that the describe is a line an operator can
 * paste into their own shell and get the identical statement — which is the
 * whole point of showing them a command rather than a summary of one. (It needs
 * the same PG* environment; the password is not in the string, by design.)
 */
export function psqlPlan(sql: string, timeoutMs: number): ExecPlan {
  return {
    kind: 'node',
    describe: describePlan({ kind: 'argv', file: 'psql', argv: [...PSQL_ARGV, sql], timeoutMs }),
    timeoutMs,
    run: () => runPsql(sql, timeoutMs),
  };
}
