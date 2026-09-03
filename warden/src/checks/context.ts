// warden/src/checks/context.ts
//
// The real world, behind the keyhole types.ts defines. Two jobs:
//
//   loadConfig()          — every path, host and process name, resolved
//                           ONCE from env with a documented default.
//   createSystemContext() — the concrete accessors, each of which turns a
//                           failure into an `Attempt` value rather than an
//                           exception or an empty success.
//
// ⚠️ NOTHING HERE MAY BE HARDCODED AT A CALL SITE. The repo disagrees with
// itself about the box in three places (infra/pm2/ecosystem.config.js still
// says /home/gungalore/app — the RETIRED box — while infra/deploy/deploy.sh
// and infra/backup/backup.sh use /home/alloutdoor/app; the committed
// infra/nginx/alloutdoor.conf still says gungalore.co.za). A check that
// bakes in one guess measures the wrong box and says "ok". Defaults below
// follow deploy.sh and backup.sh, which are what actually run against the
// live box, and every one of them is overridable by env.

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFileP, type RunOutcome } from '../proc.js';
import {
  attempt,
  failed,
  type Attempt,
  type CheckContext,
  type HistoryStore,
  type HttpJsonResponse,
  type TlsChainInfo,
  type WardenConfig,
} from '../types.js';
import { JsonFileHistory } from './history.js';

const DEFAULT_APP_ROOT = '/home/alloutdoor/app';
const DEFAULT_BACKUP_DIR = '/var/backups/alloutdoor';

function envPath(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw && raw.trim() ? raw.trim() : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WardenConfig {
  const appRoot = env.WARDEN_APP_ROOT?.trim() || DEFAULT_APP_ROOT;
  // Warden sits beside the deploy checkout, so "the repo" and "the app
  // root" are the same directory on the box — but they are separate
  // settings because a dev running Warden against a copy has them apart.
  const repoRoot = env.WARDEN_REPO_ROOT?.trim() || appRoot;
  return {
    repoRoot,
    appRoot,
    backendEnvPath: envPath('WARDEN_BACKEND_ENV_PATH', path.posix.join(repoRoot, 'backend/.env')),
    frontendEnvPath: envPath('WARDEN_FRONTEND_ENV_PATH', path.posix.join(repoRoot, 'frontend/.env.production')),
    nginxRepoConfPath: envPath('WARDEN_NGINX_REPO_CONF', path.posix.join(repoRoot, 'infra/nginx/alloutdoor.conf')),
    nginxSitesEnabledDir: envPath('WARDEN_NGINX_SITES_DIR', '/etc/nginx/sites-enabled'),
    nginxAccessLog: envPath('WARDEN_NGINX_ACCESS_LOG', '/var/log/nginx/access.log'),
    nginxErrorLog: envPath('WARDEN_NGINX_ERROR_LOG', '/var/log/nginx/error.log'),
    backupScriptPath: envPath('WARDEN_BACKUP_SCRIPT', path.posix.join(repoRoot, 'infra/backup/backup.sh')),
    backupDir: envPath('WARDEN_BACKUP_DIR', DEFAULT_BACKUP_DIR),
    // Both defaults mirror the app's OWN defaults, so Warden and the app
    // agree about which directories exist even when neither var is set:
    // SECURE_UPLOAD_DIR is what backup.sh tars, CIP_SHEETS_DIR is what it
    // does not — see checks/backups.ts.
    secureUploadDir: envPath('SECURE_UPLOAD_DIR', '/home/alloutdoor/secure-uploads'),
    cipSheetsDir: envPath('CIP_SHEETS_DIR', '/home/alloutdoor/data/cip'),
    prismaMigrationsDir: envPath('WARDEN_MIGRATIONS_DIR', path.posix.join(repoRoot, 'backend/prisma/migrations')),
    publicHost: envPath('WARDEN_PUBLIC_HOST', 'alloutdoor.co.za'),
    apiBaseUrl: envPath('WARDEN_API_BASE_URL', 'http://127.0.0.1:3001/api'),
    pm2Processes: (env.WARDEN_PM2_PROCESSES?.trim()
      ? env.WARDEN_PM2_PROCESSES.split(',').map((s) => s.trim()).filter(Boolean)
      : ['alloutdoor-backend', 'alloutdoor-frontend']) as readonly string[],
    pm2MemoryCeilings: {
      'alloutdoor-backend': 768 * 1024 * 1024,
      'alloutdoor-frontend': 512 * 1024 * 1024,
    },
    historyPath: envPath('WARDEN_HISTORY_PATH', path.posix.join(appRoot, 'warden-state/history.json')),
  };
}

export interface SystemContextOptions {
  config?: WardenConfig;
  history?: HistoryStore;
  env?: NodeJS.ProcessEnv;
}

export function createSystemContext(options: SystemContextOptions = {}): CheckContext {
  const config = options.config ?? loadConfig(options.env);
  const env = options.env ?? process.env;
  const history = options.history ?? new JsonFileHistory(config.historyPath);

  return {
    now: () => new Date(),
    config,
    history,
    cpuCount: () => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length),

    run: (file, args, opts) => execFileP(file, args, { timeoutMs: opts?.timeoutMs ?? 10_000, cwd: opts?.cwd }),

    readFile: async (p) => {
      try {
        return attempt(await fs.readFile(p, 'utf8'));
      } catch (err) {
        return failed<string>(describeFsError(p, err));
      }
    },

    stat: async (p) => {
      try {
        const s = await fs.stat(p);
        return attempt({
          path: p,
          sizeBytes: s.size,
          mtime: new Date(s.mtimeMs).toISOString(),
          isDirectory: s.isDirectory(),
        });
      } catch (err) {
        return failed(describeFsError(p, err));
      }
    },

    listDir: async (p) => {
      try {
        return attempt(await fs.readdir(p));
      } catch (err) {
        return failed<string[]>(describeFsError(p, err));
      }
    },

    queryDb: (sql, opts) => queryDb(sql, env, opts?.timeoutMs ?? 10_000),

    httpGetJson: async (url, opts) => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(opts?.timeoutMs ?? 5_000),
          headers: { accept: 'application/json' },
        });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // A non-JSON body from a health endpoint is itself the finding
          // (a proxy error page, an HTML 502). Hand it back as the raw
          // string rather than pretending the call failed.
        }
        return attempt<HttpJsonResponse>({ status: res.status, body });
      } catch (err) {
        // ⚠️ The URL may carry a secret query key (HEALTH_PING_SECRET).
        // Never put `url` in the error text.
        return failed<HttpJsonResponse>(`request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    tlsChain: (host, port, opts) => tlsChain(host, port, opts?.timeoutMs ?? 8_000),
  };
}

function describeFsError(p: string, err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return `${p} does not exist`;
  if (code === 'EACCES') return `cannot read ${p} (EACCES — Warden's service user lacks permission)`;
  if (code === 'EISDIR') return `${p} is a directory`;
  return `${p}: ${err instanceof Error ? err.message : String(err)}`;
}

// ── Postgres ────────────────────────────────────────────────────────────

/** Field separator for psql's unaligned output. A control character
 *  because it cannot occur in a column value we would ever select. */
const PSQL_FS = '\u001f';

/**
 * ⚠️ THE ONE PLACE THIS FILE TREE CALLS execFile DIRECTLY rather than
 * through proc.ts, and the reason is specific: the password must go
 * to psql through a per-CALL environment (PGPASSWORD), and proc.ts's
 * ExecOpts deliberately exposes no `env`. Putting the connection string on
 * argv instead would print the password in `ps` for every sweep — the very
 * thing infra/backup/backup.sh already goes out of its way to avoid.
 *
 * The no-shell guarantee is unchanged: this is still execFile with an argv
 * ARRAY, so there is no `/bin/sh -c` and no metacharacter to smuggle. The
 * `sql` argument is always a fixed literal from warden/src/checks/** —
 * there is no parameter channel on CheckContext.queryDb precisely because
 * no legitimate caller needs one.
 */
async function queryDb(sql: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Attempt<string[][]>> {
  const url = env.DATABASE_URL?.trim();
  if (!url) return failed<string[][]>('DATABASE_URL is not set in Warden’s environment');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failed<string[][]>('DATABASE_URL is set but is not a parseable URL');
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    PGHOST: decodeURIComponent(parsed.hostname),
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    // Deterministic output shape regardless of the box's psqlrc.
    PGCLIENTENCODING: 'UTF8',
  };

  return new Promise<Attempt<string[][]>>((resolve) => {
    execFile(
      'psql',
      ['-X', '-A', '-t', '-q', '-F', PSQL_FS, '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { env: childEnv, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          // psql's own failure text ("connection refused", "password
          // authentication failed for user X") is safe to surface; the
          // password itself is never in it because it never reached argv.
          const detail = (stderr || (error as Error).message || '').trim().split('\n')[0] ?? 'unknown error';
          resolve(failed<string[][]>(`psql failed: ${detail}`));
          return;
        }
        const rows = stdout
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => line.split(PSQL_FS));
        resolve(attempt(rows));
      },
    );
  });
}

// ── TLS ─────────────────────────────────────────────────────────────────

/**
 * The chain AS SERVED, read straight off a socket rather than shelled out
 * to `openssl s_client` — s_client reads stdin and would hang forever
 * behind execFile, which has no stdin to close.
 *
 * `rejectUnauthorized: false` is deliberate and is NOT a weakened check:
 * Warden's job is to REPORT a broken chain, and a connection that refuses
 * to complete tells us nothing about why. Node's verdict is captured in
 * `authorized` / `authorizationError` instead.
 */
function tlsChain(host: string, port: number, timeoutMs: number): Promise<Attempt<TlsChainInfo>> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: Attempt<TlsChainInfo>) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(value);
    };

    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const chain: TlsChainInfo['chain'] = [];
      let cert = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate | null;
      const seen = new Set<string>();
      while (cert && cert.subject && !seen.has(cert.fingerprint256 ?? String(chain.length))) {
        seen.add(cert.fingerprint256 ?? String(chain.length));
        chain.push({
          subject: nameOf(cert.subject),
          issuer: nameOf(cert.issuer),
          validFrom: isoOrRaw(cert.valid_from),
          validTo: isoOrRaw(cert.valid_to),
        });
        cert = cert.issuerCertificate && cert.issuerCertificate !== cert ? cert.issuerCertificate : null;
      }
      if (chain.length === 0) {
        done(failed<TlsChainInfo>(`${host}:${port} completed a handshake but presented no certificate`));
        return;
      }
      done(
        attempt({
          chain,
          authorized: socket.authorized,
          authorizationError: socket.authorized ? null : String(socket.authorizationError ?? 'unknown'),
          protocol: socket.getProtocol(),
        }),
      );
    });

    socket.on('timeout', () => done(failed<TlsChainInfo>(`no TLS handshake with ${host}:${port} within ${timeoutMs}ms`)));
    socket.on('error', (err) => done(failed<TlsChainInfo>(`cannot reach ${host}:${port} — ${err.message}`)));
  });
}

function nameOf(subject: tls.PeerCertificate['subject'] | undefined): string {
  if (!subject) return '(none)';
  const parts = Object.entries(subject as unknown as Record<string, string>)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => `${k}=${v}`);
  return parts.join(', ') || '(none)';
}

function isoOrRaw(raw: string | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

export type { RunOutcome };
