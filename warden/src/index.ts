// warden/src/index.ts
//
// THE COMPOSITION ROOT. Reads the environment, builds the pieces, starts the
// server and the sweep loop, and shuts both down cleanly. No logic lives here
// — if something in this file is doing more than wiring, it is in the wrong
// file.
//
// ⚠️ FAILS CLOSED. WARDEN_TOKEN is required and there is no default. A daemon
// that started without one would answer the backend's proxied requests from
// anything that could reach the port, which on a box that also terminates
// public traffic is not a theoretical concern. It refuses to boot instead, and
// pm2 shows a crash loop with the reason on stderr — loud beats silently open.
//
// The boot banner prints every resolved path and process name, because this
// repo disagrees with itself about the box in three places (pm2 process names,
// the app root, and nginx's server_name) and "which box did it actually
// measure" must be answerable from the log without reading the code.

import { pathToFileURL } from 'node:url';
import { loadDotEnvFile } from './env.js';
import { createSweepMemory, createSystemContext, loadConfig } from './checks/index.js';
import { createAnthropicCaller, describeModelConfig } from './diagnose/index.js';
import { WardenCore, WardenStore } from './state/index.js';
import { createServer } from './server.js';


/** How often the loop wakes. NOT how often each check runs — every check
 *  declares its own cadence and the engine skips the ones that are not due,
 *  so a short tick costs almost nothing and keeps the cheap rows current. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_PORT = 8787;

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** stdout, one line, no colour: pm2 captures this to a log file that a human
 *  greps. ⚠️ Never the token, never an env VALUE — presence and shape only. */
function log(line: string): void {
  process.stdout.write(`[warden] ${new Date().toISOString()} ${line}\n`);
}

export function fail(line: string): never {
  process.stderr.write(`[warden] ${new Date().toISOString()} FATAL ${line}\n`);
  process.exit(1);
}

export async function main(): Promise<void> {
  loadDotEnvFile();

  const token = process.env.WARDEN_TOKEN?.trim();
  if (!token) {
    fail('WARDEN_TOKEN is not set. Warden will not start without it — every route requires it and there is no unauthenticated mode.');
  }
  if (token.length < 24) {
    fail(`WARDEN_TOKEN is ${token.length} characters. Use at least 24 — this is the only thing between the daemon and anything else that can reach its port.`);
  }

  const config = loadConfig();
  const host = process.env.WARDEN_HOST?.trim() || '127.0.0.1';
  const port = num(process.env.WARDEN_PORT, DEFAULT_PORT);
  const statePath = process.env.WARDEN_STATE_PATH?.trim() || `${config.appRoot}/warden-state/state.json`;
  const sweepIntervalMs = num(process.env.WARDEN_SWEEP_INTERVAL_MS, DEFAULT_SWEEP_INTERVAL_MS);

  const store = new WardenStore({
    filePath: statePath,
    onPersistError: (error) => log(`WARN could not write ${statePath}: ${error}`),
  });
  const loaded = await store.load();
  if (!loaded.ok) {
    // An empty thread and a LOST thread look identical to an operator. Say
    // which one this is.
    log(`WARN starting with an empty thread: ${loaded.reason}`);
  }

  const model = describeModelConfig();
  const caller = createAnthropicCaller();

  const core = new WardenCore({
    store,
    ctx: createSystemContext({ config }),
    memory: createSweepMemory(),
    caller,
    diagnoseMinIntervalMs: process.env.WARDEN_DIAGNOSE_MIN_INTERVAL_MS
      ? num(process.env.WARDEN_DIAGNOSE_MIN_INTERVAL_MS, 30 * 60_000)
      : undefined,
    chatBudgetMs: process.env.WARDEN_CHAT_BUDGET_MS ? num(process.env.WARDEN_CHAT_BUDGET_MS, 18_000) : undefined,
    onError: (where, error) => log(`WARN ${where}: ${error}`),
  });

  const server = createServer({ core, token, log: (line) => log(line) });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  log(`listening on http://${host}:${port} — every route requires the bearer token`);
  log(`app root ${config.appRoot} · repo ${config.repoRoot} · pm2 ${config.pm2Processes.join(', ')}`);
  log(`nginx live ${config.nginxSitesEnabledDir} vs repo ${config.nginxRepoConfPath} · logs ${config.nginxAccessLog}, ${config.nginxErrorLog}`);
  log(`backups ${config.backupDir} via ${config.backupScriptPath} · cip ${config.cipSheetsDir} (NOT in the backup set)`);
  log(`state ${statePath} · history ${config.historyPath} · sweep every ${Math.round(sweepIntervalMs / 1000)}s`);
  log(
    caller
      ? `diagnosis enabled · model ${model.model} · ANTHROPIC_API_KEY present${model.looksLikeAnthropicKey ? '' : ' (does NOT look like an Anthropic key — check it)'}`
      : 'diagnosis DISABLED — ANTHROPIC_API_KEY is not set. The checks still run; nothing turns them into findings, and Warden raises a red gate saying so.',
  );

  // The first sweep runs now rather than one interval from now: a daemon that
  // just restarted has an empty board, and an empty board is indistinguishable
  // from a healthy one.
  void core.tick();
  const timer = setInterval(() => {
    void core.tick();
  }, sweepIntervalMs);

  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} — draining`);
    clearInterval(timer);
    server.close();
    // Wait for work a request already answered for: an approved run must
    // finish writing its audit record rather than vanishing into a restart.
    void core.drain().then(() => {
      log('stopped');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // A rejection nobody handled is a bug, but it must not take the daemon down
  // — pm2 would restart into the same state and the board would flap.
  process.on('unhandledRejection', (reason) => log(`WARN unhandled rejection: ${String(reason)}`));
}

// Only when run as the entry point, so a test can import this module without
// starting a server on a real port. pathToFileURL rather than string surgery:
// the dev box is Windows and the target is Linux, and a hand-rolled
// file:// URL is wrong on one of them.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
}
