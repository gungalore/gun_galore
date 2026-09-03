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

import { runSweep, createSweepMemory } from './engine.js';
import { createSystemContext } from './context.js';
import { ALL_CHECKS } from './registry.js';

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
