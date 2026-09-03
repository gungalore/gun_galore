// warden/src/proc.ts
//
// ONE way to run a subprocess in this whole daemon: execFile, never exec /
// spawn-with-shell. execFile hands argv[] straight to the OS — there is no
// `/bin/sh -c` in the path, so there is no shell metacharacter (`;`, `|`,
// `` ` ``, `$(...)`, `&&`) for anything to smuggle through. Every safe-list
// operation in safe-list.ts builds an argv ARRAY, never a string, for
// exactly this reason.
//
// The ONE place a real shell is used at all is executor.ts's path for a
// non-safe-list command an operator has already read and approved — see the
// warning there. Nothing in this file is that path.

import { execFile } from 'node:child_process';

export interface RunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOpts {
  timeoutMs: number;
  cwd?: string;
}

/**
 * Promisified execFile. `file` is always a fixed binary name/path from a
 * safe-list operation's own code — never a value derived from Claude's
 * output or from measured facts. `args` are the VALIDATED arguments a
 * SafeListOperation.build() assembled, one array element per argv entry.
 */
export function execFileP(file: string, args: string[], opts: ExecOpts): Promise<RunOutcome> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs, cwd: opts.cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null;
        // Node's execFile timeout kills the child with SIGTERM and reports
        // it as an error with `killed: true` and `code: null`. That is the
        // one shape we treat as "we cut it off" rather than "it failed".
        const timedOut = !!err && err.killed === true && err.code === undefined;
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? (err && timedOut ? `timed out after ${opts.timeoutMs}ms` : err ? err.message : ''),
          timedOut,
        });
      },
    );
  });
}
