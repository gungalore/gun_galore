// warden/src/checks/cli.ts
//
// `npm run sweep` — run one sweep against the real box and print the board
// as plain text. This is the first-deploy smoke test: the three
// doc-vs-repo-vs-live drifts in this repo (pm2 process names, app root,
// nginx paths) all show up here as unknowns with the exact path or command
// that failed, which is the fastest way to find out that a default in
// context.ts does not match this box.
//
// It runs the same fixed checks the daemon runs, calls no model, and runs
// no fix — printing is all it does.
//
// 🚨 IT LOADS .env FIRST, THE SAME WAY boot.ts DOES, AND FOR THE SAME REASON.
// It did not, and the consequence was that the documented smoke test LIED:
// every db-* check reported "DATABASE_URL is not set in Warden's environment"
// on a box where warden/.env sets it perfectly well, because the CLI never
// read the file the daemon reads. Sixteen of thirty checks came back "not
// measured" on a correctly-configured box — and since an honest `unknown` is
// exactly what this daemon is built to produce, nothing looked wrong.
//
// ⚠️ THE DYNAMIC IMPORT IS LOAD-BEARING, exactly as in boot.ts: ESM evaluates
// every static import before the importing module's first line, so loading
// the env file at the top of main() would already be too late for anything
// read at module top level — WARDEN_APP_ROOT among them, which decides which
// box this sweep is even describing.

import { loadDotEnvFile } from '../env.js';

loadDotEnvFile();

const { runSweep, createSweepMemory } = await import('./engine.js');
const { createSystemContext } = await import('./context.js');
const { ALL_CHECKS } = await import('./registry.js');

const MARK: Record<string, string> = { ok: 'ok  ', warn: 'WARN', bad: 'BAD ', unknown: '—   ' };

async function main(): Promise<void> {
  const ctx = createSystemContext();
  const sweep = await runSweep(ALL_CHECKS, ctx, createSweepMemory(), { force: true });

  for (const r of sweep.results) {
    process.stdout.write(`${MARK[r.status] ?? '?'} ${r.id.padEnd(22)} ${r.verdict}\n`);
    for (const e of r.evidence) {
      process.stdout.write(`         ${e.label}: ${e.value}${e.from ? `   [${e.from}]` : ''}\n`);
    }
  }
  process.stdout.write(
    `\n${sweep.results.length} checks in ${sweep.durationMs}ms — ` +
      `${sweep.counts.ok} ok, ${sweep.counts.warn} warn, ${sweep.counts.bad} bad, ${sweep.counts.unknown} not measured\n`,
  );
}

main().catch((err: unknown) => {
  // Reaching here means the SWEEP itself failed, not a check — a check
  // that fails is an unknown row above. Exit non-zero so a smoke test on
  // the box notices.
  process.stderr.write(`sweep failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
