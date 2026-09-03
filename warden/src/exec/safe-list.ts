// warden/src/exec/safe-list.ts
//
// THE SAFE LIST — the ONLY operations Warden may run without a human first
// reading the exact command (rule 4 of the security model). Every entry is a
// PARAMETERISED OPERATION: a fixed `name`, a tiny argument shape checked
// against a closed enum, and a `build()` that turns the VALIDATED args into an
// ExecPlan. Claude's whole role is picking a `name` and, where the op takes an
// argument, a VALUE FROM THE ENUM THIS FILE DEFINES. It never writes a command,
// a path, or a process name, and nothing it emits is ever interpolated into a
// string that reaches a shell.
//
// ⚠️ validate() IS THE ONLY GATE. build() deliberately re-checks nothing, so
// there is exactly one place this can be got wrong rather than two that drift.
// Anything build() would want to re-check belongs in validate() instead.
//
// Ground rules every entry below satisfies (each `reasoning` field carries the
// specific case, and those strings are what an operator reads in the Desk):
//   · Nothing here deletes data outright — log rotation archives first.
//   · Nothing here touches the schema, a table's rows, Postgres itself, a
//     secret, an env value, or a config file.
//   · Nothing here sends anything through an outbound channel (SMS, email,
//     push, WhatsApp) — those reach real people and cost real money per send.
//   · Nothing here needs a privilege the app user does not already hold,
//     except reloadNginx, which needs one narrow sudoers line (see its note).
//   · Every op is safe to run twice: it either no-ops or repeats the same
//     bounded thing, never compounds.
//
// DELIBERATELY NOT ON THIS LIST, and never to be added (this is the reviewed
// boundary, not an oversight — these are red gates or operator-approved
// commands instead): `prisma migrate deploy` or any schema change; any DB row
// write; any secret/env rotation (rotating ID_HASH_SECRET destroys every
// stored KYC file); any PAYMENT_MODE / PAYMENTS_LIVE / VERIFYNOW_MODE flip;
// restarting Postgres; any git operation on the deploy branch; anything that
// sends on an outbound channel; anything needing a broader sudo grant than the
// single nginx-reload line.

import path from 'node:path';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { describePlan, runPlan, type ExecPlan, type RunOutcome } from './proc.js';

// ── the box, named once ─────────────────────────────────────────────────────
//
// ⚠️ VERIFY AGAINST THE LIVE BOX BEFORE FIRST DEPLOY. The repo contradicts
// itself: infra/pm2/ecosystem.config.js still says /home/gungalore/app and
// gungalore-* process names (the RETIRED box), while infra/deploy/deploy.sh and
// infra/backup/backup.sh — the scripts that actually run against the live box —
// use /home/alloutdoor/app and alloutdoor-*. This module follows deploy.sh.
// A wrong value here fails CLOSED, never silently: the path does not exist, the
// plan exits non-zero, and that lands in the thread as a failed run carrying
// the real stderr. Override with WARDEN_APP_ROOT rather than editing the
// constant — config from env, never a path baked into a release.
const APP_ROOT = process.env.WARDEN_APP_ROOT?.trim() || '/home/alloutdoor/app';
const LOG_DIR = `${APP_ROOT}/logs`;
const ARCHIVE_DIR = `${APP_ROOT}/warden-archive`;

export const PM2_PROCESSES = ['alloutdoor-backend', 'alloutdoor-frontend'] as const;
export type Pm2Process = (typeof PM2_PROCESSES)[number];

/** ⚠️ The closed set of log ids. There is deliberately no "path" argument
 *  anywhere in this file — a path is the one thing a poisoned fact would most
 *  want to supply. */
export const LOG_IDS = [
  'backendError',
  'backendOut',
  'frontendError',
  'frontendOut',
  'nginxAccess',
  'nginxError',
] as const;
export type LogId = (typeof LOG_IDS)[number];

export const LOG_FILES: Readonly<Record<LogId, string>> = Object.freeze({
  backendError: `${LOG_DIR}/backend-error.log`,
  backendOut: `${LOG_DIR}/backend-out.log`,
  frontendError: `${LOG_DIR}/frontend-error.log`,
  frontendOut: `${LOG_DIR}/frontend-out.log`,
  // Stock Ubuntu nginx defaults — infra/nginx/alloutdoor.conf sets no explicit
  // access_log/error_log, so nginx uses these. Confirm with `nginx -T` on the
  // box; a wrong path fails closed ("does not exist"), never silently.
  nginxAccess: '/var/log/nginx/access.log',
  nginxError: '/var/log/nginx/error.log',
});

// ── shared shape ────────────────────────────────────────────────────────────

export interface BuiltOperation {
  plan: ExecPlan;
  /** Derived from `plan` by describePlan(), never hand-written beside it, so
   *  it cannot drift from what actually runs. This is the string the Desk
   *  shows and that `expectedCommand` echoes back on approve. */
  describe: string;
}

export type ValidationResult<Args> = { ok: true; args: Args } | { ok: false; error: string };

export interface SafeListOperation<Args> {
  name: string;
  summary: string;
  /** The reviewable case for why this may run with no human in the loop. Not a
   *  claim — the actual argument, rendered to the operator in the Desk. */
  reasoning: string;
  reversible: boolean;
  /** Minimum gap between two runs with the SAME resolved args. A courtesy damp
   *  on a flapping condition re-triggering its own fix in a loop — NOT a
   *  security boundary (it lives in memory and resets with the daemon), and
   *  deliberately not applied to a run an operator personally approved. */
  cooldownMs: number;
  /** Never throws: a malformed selection is data a model can get wrong, not a
   *  crash. */
  validate(raw: unknown): ValidationResult<Args>;
  build(args: Args): BuiltOperation;
}

// ── argument validators ─────────────────────────────────────────────────────

/** Rejects arrays and non-objects. An array passes a naive `typeof === object`
 *  check and then reads `raw.process` as undefined — refusing it outright says
 *  so, instead of failing later behind a confusing enum message. */
function asPlainObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * For the zero-argument operations. Extra keys are REFUSED, not ignored: a
 * smuggled field means whatever produced this selection misunderstood the
 * operation, and failing loudly surfaces that rather than running something the
 * caller believed it had parameterised.
 */
function requireNoArgs(raw: unknown): ValidationResult<Record<string, never>> {
  if (raw === undefined || raw === null) return { ok: true, args: {} };
  const obj = asPlainObject(raw);
  if (!obj) return { ok: false, error: 'takes no arguments; expected {} or nothing' };
  const keys = Object.keys(obj);
  if (keys.length > 0) return { ok: false, error: `takes no arguments, but got: ${keys.join(', ')}` };
  return { ok: true, args: {} };
}

/**
 * Exact membership in a fixed tuple. ⚠️ LOAD-BEARING: this is an includes() on
 * a literal tuple — never `key in someObject`, never a regex over the value.
 * `in` walks the prototype chain, so `__proto__`, `constructor` and `toString`
 * all pass it; a lookup gated that way would accept them, hand back
 * Object.prototype's member instead of a path, and blow up (or worse) inside
 * build(). exec/safe-list.test.ts pins each of those names as refused.
 */
function requireEnum<T extends string>(raw: unknown, field: string, allowed: readonly T[]): ValidationResult<T> {
  // ⚠️ Every refusal names the field AND lists the whole allowed set, in the
  // fixed wording `<field> must be one of: …`. That is not cosmetic: the
  // diagnosis layer builds the menu Claude picks from by probing validate({})
  // and printing what it complains about (see diagnose/prompt.ts), so this
  // string IS the published enum. A message that omits the values leaves the
  // model choosing blind; a second hand-written copy of the list would be free
  // to drift from the gate.
  const shape = `${field} must be one of: ${allowed.join(', ')}`;
  const obj = asPlainObject(raw);
  if (!obj) return { ok: false, error: `expected an object with a "${field}" field; ${shape}` };
  const value = obj[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return { ok: false, error: shape };
  }
  const extra = Object.keys(obj).filter((k) => k !== field);
  if (extra.length > 0) return { ok: false, error: `unexpected argument(s): ${extra.join(', ')}` };
  return { ok: true, args: value as T };
}

function built(plan: ExecPlan): BuiltOperation {
  return { plan, describe: describePlan(plan) };
}

function outcome(stdout: string, exitCode = 0, stderr = ''): RunOutcome {
  return { exitCode, stdout, stderr, timedOut: false };
}

// ── 1. restartProcess ───────────────────────────────────────────────────────
//
// SAFE because it is the IDENTICAL graceful reload infra/deploy/deploy.sh
// already runs unattended on every deploy — not a new class of risk, the
// existing one made self-triggerable. pm2's own min_uptime/max_restarts already
// bound a crash-looping process, so this can trigger one attempt but cannot
// make a loop worse. The process name is one of exactly two fixed strings,
// matched whole; it is never text a model composed.
export const restartProcess: SafeListOperation<{ process: Pm2Process }> = {
  name: 'restartProcess',
  summary: 'Gracefully reload the backend or frontend pm2 process.',
  reasoning:
    'The same reload deploy.sh already runs unattended on every deploy. pm2 drains the old process before killing it, and its own min_uptime/max_restarts already bound a bad restart. The process name is one of two fixed strings, never composed text.',
  reversible: true,
  cooldownMs: 2 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'process', PM2_PROCESSES);
    return r.ok ? { ok: true, args: { process: r.args } } : r;
  },
  build(args) {
    return built({ kind: 'argv', file: 'pm2', argv: ['reload', args.process, '--update-env'], timeoutMs: 30_000 });
  },
};

// ── 2. truncateLog ──────────────────────────────────────────────────────────
//
// SAFE because nothing is deleted: the file is gzipped to Warden's own archive
// FIRST, and only then truncated to 0 bytes IN PLACE (same inode), so pm2 and
// nginx keep writing to the descriptor they already hold and need no reload. A
// no-op when the file is already empty, so a re-firing alarm cannot pile up
// archives. The path comes from a frozen map keyed by a closed enum — this
// operation has no path argument at all.
export const truncateLog: SafeListOperation<{ logId: LogId }> = {
  name: 'truncateLog',
  summary: 'Archive a known log file to gzip, then truncate it to 0 bytes in place.',
  reasoning:
    'Archives before truncating, so nothing is lost. Truncates the existing inode rather than deleting or renaming it, so nothing needs a reload and there is no window where the file is missing. The path is one of six fixed constants — the operation has no path argument.',
  reversible: false,
  cooldownMs: 60 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'logId', LOG_IDS);
    return r.ok ? { ok: true, args: { logId: r.args } } : r;
  },
  build(args) {
    const filePath = LOG_FILES[args.logId];
    return built({
      kind: 'node',
      describe: `archive ${filePath} to ${ARCHIVE_DIR}/${args.logId}-<timestamp>.gz, then truncate ${filePath} to 0 bytes in place`,
      timeoutMs: 60_000,
      run: async () => {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) return outcome('', 1, `${filePath} does not exist`);
        if (stat.size === 0) return outcome(`${filePath} is already 0 bytes — nothing to do`);
        await fs.mkdir(ARCHIVE_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archivePath = path.join(ARCHIVE_DIR, `${args.logId}-${stamp}.gz`);
        await pipeline(createReadStream(filePath), createGzip(), createWriteStream(archivePath));
        // fs.truncate operates on the existing inode — it does not unlink and
        // recreate — which is why nothing needs to reopen the file.
        await fs.truncate(filePath, 0);
        return outcome(`archived ${stat.size} bytes to ${archivePath}; ${filePath} truncated to 0 bytes`);
      },
    });
  },
};

// ── 3. reloadNginx ──────────────────────────────────────────────────────────
//
// SAFE because `nginx -s reload` only makes nginx re-read what is ALREADY on
// disk and re-open its log and cert files, without dropping an in-flight
// connection. It never edits config — a config edit is a commit, i.e. a red
// gate, never something this daemon writes.
//
// ⚠️ THE ONE OP NEEDING A PRIVILEGE BOUNDARY. nginx's master runs as root; the
// app user does not. This needs one narrow NOPASSWD sudoers line and no more:
//     alloutdoor ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
// No wildcard, no other nginx subcommand, no other binary. `sudo -n` means a
// missing sudoers entry fails closed with "a password is required" on stderr
// rather than hanging on a prompt nobody can answer.
export const reloadNginx: SafeListOperation<Record<string, never>> = {
  name: 'reloadNginx',
  summary: 'Ask nginx to re-read its config and re-open its log and cert files.',
  reasoning:
    "nginx's own graceful reload: it re-reads what is already on disk, drops zero in-flight connections, and never edits the config it reads. It takes no arguments, so there is nothing here for a poisoned diagnosis to steer.",
  reversible: true,
  cooldownMs: 60_000,
  validate: requireNoArgs,
  build() {
    return built({ kind: 'argv', file: 'sudo', argv: ['-n', '/usr/sbin/nginx', '-s', 'reload'], timeoutMs: 15_000 });
  },
};

// ── 4. rerunBackup ──────────────────────────────────────────────────────────
//
// SAFE because it is the exact script that already runs unattended at 02:10
// SAST. Every run writes a NEW timestamped dump and tar rather than overwriting
// one, and the script's own retention sweep ages copies out at 14 days — so an
// early or duplicate run cannot lose data. Its success path is the same
// heartbeat the backups check reads, so triggering it early cannot
// desynchronise anything Warden itself measures.
export const rerunBackup: SafeListOperation<Record<string, never>> = {
  name: 'rerunBackup',
  summary: 'Run the nightly backup script now instead of waiting for 02:10 SAST.',
  reasoning:
    'The exact script that already runs unattended nightly. Every run adds a new timestamped copy rather than overwriting one, so the worst case of an extra run is one more dump the existing retention sweep ages out in 14 days.',
  reversible: true,
  // pg_dump plus a tar of the upload tree is heavy enough that re-running it
  // more than hourly only burns I/O the app also needs.
  cooldownMs: 60 * 60_000,
  validate: requireNoArgs,
  build() {
    // ⚠️ Minutes, not seconds — and deliberately unrelated to any HTTP budget.
    // This is only ever awaited by the daemon's own background loop; see the
    // note at the top of executor.ts on why no request handler may await a run.
    return built({ kind: 'argv', file: `${APP_ROOT}/infra/backup/backup.sh`, argv: [], timeoutMs: 10 * 60_000 });
  },
};

// ── 5. clearNextCache ───────────────────────────────────────────────────────
//
// SAFE because `.next/cache` holds ONLY Next.js's regenerable incremental
// cache — never source, and never `.next/` itself, which holds the built app
// and whose deletion would take the site down. Emptying it is Next's own
// documented "the cache looks stale" recovery. The reload afterwards just drops
// whatever copy the running process still holds in memory.
export const clearNextCache: SafeListOperation<Record<string, never>> = {
  name: 'clearNextCache',
  summary: "Clear Next.js's regenerable build cache and reload the frontend.",
  reasoning:
    "The directory holds only regenerated build cache; the frontend recreates every entry on the next request that needs it. Fixed path, no arguments, and never .next/ itself — Next's own documented stale-cache recovery.",
  reversible: true,
  cooldownMs: 10 * 60_000,
  validate: requireNoArgs,
  build() {
    const dir = `${APP_ROOT}/frontend/.next/cache`;
    return built({
      kind: 'node',
      describe: `delete the contents of ${dir}/ (never .next/ itself), then pm2 reload alloutdoor-frontend --update-env`,
      timeoutMs: 45_000,
      run: async () => {
        const entries = await fs.readdir(dir).catch(() => [] as string[]);
        for (const entry of entries) {
          // Joined against a name read from the directory itself, never from an
          // argument — there is no caller-supplied path component here.
          await fs.rm(path.join(dir, entry), { recursive: true, force: true });
        }
        const reload = await runPlan({
          kind: 'argv',
          file: 'pm2',
          argv: ['reload', 'alloutdoor-frontend', '--update-env'],
          timeoutMs: 30_000,
        });
        return {
          ...reload,
          stdout: `cleared ${entries.length} cache entr${entries.length === 1 ? 'y' : 'ies'} from ${dir}\n${reload.stdout}`,
        };
      },
    });
  },
};

// ── 6. pruneLogArchives ─────────────────────────────────────────────────────
//
// SAFE because it only ever deletes files truncateLog itself wrote, in the one
// directory this daemon owns, past a fixed age — the same retention shape
// backup.sh already uses on its own dumps. It exists so the safe list's
// disk-saving op cannot quietly become a disk-filling one over months.
export const pruneLogArchives: SafeListOperation<Record<string, never>> = {
  name: 'pruneLogArchives',
  summary: "Delete truncateLog's own archived .gz files older than 14 days.",
  reasoning:
    'Only touches files this daemon wrote, in the directory this daemon owns, past a fixed age — the same retention shape backup.sh uses on its own dumps.',
  reversible: false,
  cooldownMs: 24 * 60 * 60_000,
  validate: requireNoArgs,
  build() {
    const KEEP_DAYS = 14;
    return built({
      kind: 'node',
      describe: `delete *.gz under ${ARCHIVE_DIR}/ older than ${KEEP_DAYS} days`,
      timeoutMs: 30_000,
      run: async () => {
        const entries = await fs.readdir(ARCHIVE_DIR).catch(() => [] as string[]);
        const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60_000;
        let removed = 0;
        for (const entry of entries) {
          if (!entry.endsWith('.gz')) continue;
          const full = path.join(ARCHIVE_DIR, entry);
          const stat = await fs.stat(full).catch(() => null);
          if (stat && stat.mtimeMs < cutoff) {
            await fs.rm(full, { force: true });
            removed++;
          }
        }
        return outcome(`removed ${removed} archive(s) older than ${KEEP_DAYS} days`);
      },
    });
  },
};

// ── the registry ────────────────────────────────────────────────────────────

// The `any` is confined to the registry's element type: each operation is
// internally sound over its own Args, but a heterogeneous list of them has no
// single useful parameter. findSafeListOperation() narrows it back to unknown
// at the boundary, which is what callers actually get.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SAFE_LIST: readonly SafeListOperation<any>[] = Object.freeze([
  restartProcess,
  truncateLog,
  reloadNginx,
  rerunBackup,
  clearNextCache,
  pruneLogArchives,
]);

/** Exact-name lookup. ⚠️ Never a prefix, fuzzy or case-insensitive match: the
 *  name arrives from a model's output, and "close enough" is exactly how the
 *  wrong operation gets picked. */
export function findSafeListOperation(name: unknown): SafeListOperation<unknown> | null {
  if (typeof name !== 'string') return null;
  return SAFE_LIST.find((op) => op.name === name) ?? null;
}
