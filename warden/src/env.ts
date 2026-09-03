// warden/src/env.ts
//
// The .env loader, and NOTHING ELSE. It lives in its own module with zero
// imports from the app tree for one reason: something has to read the file
// BEFORE any module that reads process.env is evaluated, and in ESM the only
// way to guarantee that is for the loader to be reachable without pulling the
// app in behind it. src/boot.ts is the entry that uses it that way.
//
// 🚨 WHY THIS MOVED OUT OF index.ts. It used to be defined there and called as
// the first line of main() — which reads correctly and was wrong. ESM hoists
// and evaluates every static import before a single line of the importing
// module's body runs, so `import { … } from './checks/index.js'` (and the
// diagnose, state and server trees behind it) had already been evaluated by
// the time main() existed to be called. Any module-top-level `process.env`
// read in that graph therefore saw the environment WITHOUT the .env file.
//
// That was not hypothetical. Four documented overrides were silently dead:
//   · ANTHROPIC_MODEL_WARDEN / ANTHROPIC_MODEL_JUDGE — diagnose/client.ts
//   · WARDEN_MODEL_TIMEOUT_MS                        — diagnose/client.ts
//   · WARDEN_APP_ROOT                                — exec/safe-list.ts
// and the last one matters most: safe-list.ts's own comment tells you to
// "Override with WARDEN_APP_ROOT rather than editing the constant", while
// ecosystem.config.js deliberately ships NO env block ("NO SECRETS, NO env
// BLOCK") and points at this .env as the delivery path. So on a box whose
// checkout is not /home/alloutdoor/app, every log path and the backup rerun
// silently targeted a directory that does not exist — and the boot banner
// printed the default back, confirming the wrong value.
//
// Fixing the ordering once, here, fixes all four AND every future
// module-top-level read. The alternative — making each constant lazy — is
// whack-a-mole against a mistake that is invisible when you make it.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A minimal, dependency-free .env loader — the same job backend/src/main.ts's
 * `dotenv.config()` does, kept in-tree rather than pulling in a package for
 * three lines of parsing. Loads `<cwd>/.env` (or `WARDEN_ENV_FILE` if set) so
 * WARDEN_TOKEN, ANTHROPIC_API_KEY and DATABASE_URL can live in a file instead
 * of the pm2 ecosystem config — see the "NO SECRETS, NO env BLOCK" convention
 * in ecosystem.config.js, which this mirrors.
 *
 * Never overrides a value already set in the real environment (pm2 `env`
 * block, shell export, systemd unit) — a file on disk fills gaps, it does not
 * win arguments. Missing file is not an error: env vars may simply be supplied
 * another way.
 *
 * Idempotent by construction (it only ever fills a gap), so calling it twice
 * is harmless — which is why main() still calls it as well. That keeps main()
 * self-sufficient for a direct import in a test without depending on boot.ts
 * having run first.
 */
export function loadDotEnvFile(): void {
  const file = process.env.WARDEN_ENV_FILE?.trim() || path.join(process.cwd(), '.env');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
