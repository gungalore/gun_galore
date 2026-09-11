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
// ⚠️ THE INVARIANT EVERY ENTRY BELOW DEFENDS, and the one to re-read before
// adding a thirteenth: THERE IS NO CODE PATH FROM THE MODEL'S TOKENS TO AN ARGV
// THAT SKIPS validate(). Claude picks a NAME, and at most a VALUE FROM AN ENUM
// THIS FILE DEFINES. It never supplies a pid, a path, a signal, a size, a
// process name it composed, or a line of SQL. Those are not arguments this
// design happens to lack — they are the failure it exists to make impossible,
// and every argument below is either a member of a frozen tuple or nothing at
// all. Where an operation needs a number (a vacuum target, a query age), the
// number is a CONSTANT in this file selected by an enum KEY, never a value that
// arrived from outside it.
//
// Ground rules every entry below satisfies (each `reasoning` field carries the
// specific case, and those strings are what an operator reads in the Desk):
//   · Nothing here touches the schema, a table's rows, a secret, an env value,
//     or a config file.
//   · Nothing here sends anything through an outbound channel (SMS, email,
//     push, WhatsApp) — those reach real people and cost real money per send.
//   · Every op is safe to run twice: it either no-ops or repeats the same
//     bounded thing, never compounds.
//
// ⚠️ THREE GROUND RULES WERE NARROWED WHEN THE EMERGENCY OPERATIONS LANDED,
// AND THE OLD WORDING IS RECORDED HERE BECAUSE IT READ AS A GUARANTEE AND A
// READER WILL OTHERWISE GO ON TRUSTING IT:
//   · "Nothing here deletes data outright — log rotation archives first" is
//     now FALSE BY DESIGN. truncateLogUnarchived exists precisely because
//     truncateLog gzips into an archive on the SAME DISK before it truncates —
//     so on a 100%-full disk, the one case it exists for, the gzip write fails
//     and nothing is freed. The answer was not to make the safe operation
//     conditionally lossy; it was a second operation, under its own name, whose
//     reasoning says plainly that the contents are gone. pruneLogArchives,
//     pruneJournal and pruneNpmCache also delete outright.
//   · "Nothing here touches … Postgres itself" now holds only for the SERVER.
//     cancelLongQuery and terminateIdleInTransaction end a SESSION. They write
//     no row, change no setting, install no extension and never signal the
//     postmaster; Postgres rolls the ended session's transaction back
//     atomically, so what they destroy is work in flight, never committed data.
//   · "Nothing here needs a privilege the app user does not already hold,
//     except reloadNginx" is now except reloadNginx AND pruneJournal. Each
//     needs ONE exact-argv NOPASSWD sudoers line, written out in full in its
//     own note. ⚠️ A THIRD LINE IS A BOUNDARY DECISION, NOT A NEW OPERATION —
//     and neither line has a provisioning step anywhere under infra/, so the
//     box gets them only because an operator reads warden/README.md's
//     "Permissions the box needs" and adds them by hand. exec/safe-list.test.ts
//     builds every operation, finds the ones whose TOP-LEVEL plan is argv on
//     sudo, and fails if the exact line is not in that section.
//     ⚠️ THAT DERIVATION IS BLIND TO A node PLAN, and node plans are an
//     established shape here — clearNextCache calls runPlan() from inside
//     run(). An operation reaching sudo that way was invisible to it and
//     shipped green; so the same test now also counts the `file: 'sudo'`
//     literals in THIS file and fails when that number outruns the operations
//     it could derive a line from. Between them: a third sudo operation cannot
//     ship undocumented. Nothing can make an unprovisioned box run.
//
// DELIBERATELY NOT ON THIS LIST, and never to be added (this is the reviewed
// boundary, not an oversight — these are red gates or operator-approved
// commands instead): `prisma migrate deploy` or any schema change; any DB row
// write; any secret/env rotation (rotating ID_HASH_SECRET destroys every
// stored KYC file); any PAYMENT_MODE / PAYMENTS_LIVE / VERIFYNOW_MODE flip;
// RESTARTING POSTGRES (ending one session is not restarting the server, and
// that distinction is the whole reason the two database operations below are
// allowed at all); any git operation on the deploy branch; anything that sends
// on an outbound channel; anything needing a broader sudo grant than the two
// exact-argv lines already named.

import path from 'node:path';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { describePlan, psqlPlan, runPlan, type ExecPlan, type RunOutcome } from './proc.js';

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

/**
 * Where pm2 writes the marketplace processes' logs.
 *
 * 🚨 THIS WAS `${APP_ROOT}/logs` AND THAT DIRECTORY DOES NOT EXIST. pm2 was
 * never told otherwise for alloutdoor-backend/-frontend, so it uses its own
 * default — `~/.pm2/logs/<name>-{error,out}.log` — verified on the live box
 * via `pm2 jlist` (pm_err_log_path). The crash-output check was therefore
 * PERMANENTLY blind, reporting "no process error log could be read" every
 * sweep, and it read as a provisioning gap rather than a wrong constant.
 *
 * ⚠️ warden's OWN logs DO live under ${APP_ROOT}/logs, because
 * ecosystem.config.cjs sets error_file/out_file explicitly. That coincidence
 * is what made the wrong default look plausible.
 */
const PM2_LOG_DIR =
  process.env.WARDEN_PM2_LOG_DIR?.trim() ||
  `${process.env.HOME?.trim() || '/home/alloutdoor'}/.pm2/logs`;
/**
 * Where pm2 writes THIS daemon's own logs.
 *
 * ⚠️ NOT PM2_LOG_DIR, and the asymmetry is real rather than an oversight:
 * warden/ecosystem.config.cjs sets error_file/out_file explicitly for the
 * `warden` process, while alloutdoor-backend/-frontend were never told and so
 * fall back to pm2's own default. That is the same coincidence PM2_LOG_DIR's
 * note names as what once made the wrong default look plausible — so the two
 * constants stay separate, and neither may be derived from the other.
 */
const WARDEN_LOG_DIR = `${APP_ROOT}/logs`;

/**
 * Where truncateLog parks a gzipped log before truncating it.
 *
 * ⚠️ EXPORTED so env-order.test.ts can probe it. It derives from APP_ROOT at
 * module scope, which is precisely the property that test exists to prove — the
 * probe used to read LOG_FILES.backendError, and that stopped deriving from
 * APP_ROOT when the pm2 paths were corrected to ~/.pm2/logs. A test whose probe
 * no longer touches the thing under test passes for the wrong reason. (It is no
 * longer the ONLY APP_ROOT-derived constant here — WARDEN_LOG_DIR above is one
 * too — but the probe reads THIS one, so keep this one derived.)
 *
 * ⚠️ IT SITS INSIDE THE GIT WORKING TREE — APP_ROOT on the box IS the repo
 * root, so this is a top-level sibling of warden/, not a child of it. The root
 * .gitignore covers it; warden/.gitignore cannot reach it.
 */
export const ARCHIVE_DIR = `${APP_ROOT}/warden-archive`;

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
  // 🚨 WARDEN COULD RELIEVE EVERY LOG ON THE BOX EXCEPT ITS OWN — which is
  // the one you want when Warden is what is misbehaving. A sweep that throws
  // every 60 seconds writes a stack trace a minute into warden-error.log, and
  // until these two ids existed nothing on this list could touch it. The
  // omission was invisible because the enum reads complete: six ids, four
  // processes' worth of logs, no gap to notice.
  //
  // ⚠️ Truncating your own log while you are writing to it is fine, and for
  // exactly the reason it is fine for pm2's and nginx's: fs.truncate acts on the
  // EXISTING INODE, so the descriptor pm2 holds open for this process stays
  // valid and keeps appending. What is lost is the LOG record of the run doing
  // the truncating — the audit record, which is written to Warden's state file
  // and not to a log, is the account that survives it.
  'wardenError',
  'wardenOut',
] as const;
export type LogId = (typeof LOG_IDS)[number];

export const LOG_FILES: Readonly<Record<LogId, string>> = Object.freeze({
  // pm2's own naming: <process name>-error.log / -out.log.
  backendError: `${PM2_LOG_DIR}/alloutdoor-backend-error.log`,
  backendOut: `${PM2_LOG_DIR}/alloutdoor-backend-out.log`,
  frontendError: `${PM2_LOG_DIR}/alloutdoor-frontend-error.log`,
  frontendOut: `${PM2_LOG_DIR}/alloutdoor-frontend-out.log`,
  // Stock Ubuntu nginx defaults — infra/nginx/alloutdoor.conf sets no explicit
  // access_log/error_log, so nginx uses these. Confirm with `nginx -T` on the
  // box; a wrong path fails closed ("does not exist"), never silently.
  nginxAccess: '/var/log/nginx/access.log',
  nginxError: '/var/log/nginx/error.log',
  // ⚠️ WARDEN_LOG_DIR, not PM2_LOG_DIR — see that constant's note. The
  // basenames are copied from ecosystem.config.cjs's error_file/out_file
  // verbatim; a wrong one fails closed as "does not exist", never silently.
  wardenError: `${WARDEN_LOG_DIR}/warden-error.log`,
  wardenOut: `${WARDEN_LOG_DIR}/warden-out.log`,
});

/**
 * How long a database session must have been in one state before an operation
 * may end it.
 *
 * ⚠️ THE MODEL SUPPLIES THE KEY; THIS FILE SUPPLIES THE VALUE. That is the
 * LOG_FILES shape exactly, and it is the whole reason a number is allowed to
 * appear inside a statement at all: the only thing ever interpolated into the
 * SQL below is a string constant looked up in a frozen map by a key that has
 * already passed requireEnum. No arithmetic on a model-supplied number, no
 * free-form interval, and no route from `args` into the statement that does not
 * pass through this map.
 *
 * The floor is five minutes, not the 60s at which checks/database.ts calls a
 * running query bad. 60s is the ceiling for a WEB request; a pg_dump, a GIN
 * index build or the reloading-manual FTS backfill legitimately runs far longer
 * than that, and an operation that could be pointed at them is not one this
 * list should carry.
 */
export const QUERY_AGES = ['5m', '15m', '1h'] as const;
export type QueryAge = (typeof QUERY_AGES)[number];

const AGE_INTERVAL: Readonly<Record<QueryAge, string>> = Object.freeze({
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
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

// ── 2. startProcess ────────────────────────────────────────────────
//
// 🚨 THE SINGLE MOST LIKELY EMERGENCY HAD NO OPERATION ON THIS LIST. `pm2
// reload` acts on a RUNNING process; handed an app pm2 holds in `stopped` or
// `errored` it reports the app as not running rather than starting it. And
// checks/pm2.ts goes `bad` on exactly that — its test is `p.status !== 'online'`,
// which covers stopped and errored as well as gone. So "the backend is down"
// was a fault Warden could measure, could describe, and could answer only with
// a reload that would not have helped. The gap was invisible because
// restartProcess LOOKS like the answer: its name says restart.
//
// ⚠️ THE NARROW CLAIM, AND THE GAP NAMED: what is asserted here is that `pm2
// start <name>` starts an app pm2 is holding stopped. Whether the pm2 version
// on the box would ALSO have started it on `reload` was NOT re-verified against
// that box during this pass. If it turns out reload does start a stopped app,
// this operation is redundant rather than wrong, and restartProcess's own
// safety argument is untouched either way.
//
// ⚠️ A SEPARATE OPERATION, NOT A FLAG ON restartProcess. A flag is an
// argument, and an argument is a thing a poisoned diagnosis can steer; two
// names carrying one fixed verb each cannot be steered from one into the other.
//
// SAFE because pm2 refuses to start a second copy of an app it already has
// online — it answers "already launched" and changes nothing — so the
// run-twice rule holds by pm2's own behaviour rather than by us reading the
// state first and racing it. The process name is one of exactly two fixed
// strings, matched whole; it is never text a model composed.
export const startProcess: SafeListOperation<{ process: Pm2Process }> = {
  name: 'startProcess',
  summary: 'Start the backend or frontend pm2 process when pm2 has it stopped or errored.',
  reasoning:
    'The only operation that answers a process pm2 has stopped, which restartProcess cannot: pm2 reload acts on a running app and reports a stopped one as not running rather than starting it. pm2 refuses to start a second copy of an app it already has online, so a mistaken run changes nothing. The process name is one of two fixed strings, never composed text.',
  reversible: true,
  cooldownMs: 2 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'process', PM2_PROCESSES);
    return r.ok ? { ok: true, args: { process: r.args } } : r;
  },
  build(args) {
    return built({ kind: 'argv', file: 'pm2', argv: ['start', args.process, '--update-env'], timeoutMs: 30_000 });
  },
};

// ── 3. truncateLog ──────────────────────────────────────────────────────────
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
    'Archives before truncating, so nothing that reached the archive is lost. Truncates the existing inode rather than deleting or renaming it, so nothing needs a reload and there is no window where the file is missing. The path is one of eight fixed constants — the operation has no path argument. It writes that archive to the same disk as the log, so on a full disk it frees nothing and leaves the log intact; truncateLogUnarchived is the operation for that case.',
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
        // ⚠️ THE ARCHIVE SHARES THE LOG'S DISK. On a genuinely full disk the
        // pipeline below throws before the truncate ever runs, and execute()
        // turns that into an audit record with exitCode null and the log left
        // INTACT. That is the right failure — but it means this operation is
        // weakest in exactly the case host-disk calls critical, which is why
        // truncateLogUnarchived exists as a separate, honestly-named entry
        // instead of as a fallback branch inside this one.
        await fs.mkdir(ARCHIVE_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archivePath = path.join(ARCHIVE_DIR, `${args.logId}-${stamp}.gz`);
        await pipeline(createReadStream(filePath), createGzip(), createWriteStream(archivePath));
        // ⚠️ "Nothing is lost" holds for every byte that reached the gzip
        // stream, and no wider: whatever the process appends between the
        // pipeline's EOF above and the truncate below is discarded unarchived.
        // On an idle log that window is empty; on the busy log you would
        // actually be relieving, it is not.
        //
        // fs.truncate operates on the existing inode — it does not unlink and
        // recreate — which is why nothing needs to reopen the file.
        await fs.truncate(filePath, 0);
        // ⚠️ stat.size is the PRE-READ size, not what was gzipped. If the
        // file grew between the stat and the pipeline, this under-reports the
        // archive. Cosmetic — but it is a number in an audit row, so name it
        // rather than let a reader take it for a measurement made after.
        return outcome(`archived ${stat.size} bytes to ${archivePath}; ${filePath} truncated to 0 bytes`);
      },
    });
  },
};

// ── 4. truncateLogUnarchived ──────────────────────────────────────
//
// 🚨 THE LOSSY TWIN, AND IT EXISTS BECAUSE THE SAFE ONE CANNOT DO THE JOB IT
// WAS ADDED FOR. truncateLog gzips into ARCHIVE_DIR, which sits on the same
// disk as the log it is relieving — so at 100% full, the exact condition the
// operation exists to clear, the archive write fails and NOTHING IS FREED.
//
// ⚠️ THE FIX WAS NOT TO MAKE truncateLog CONDITIONALLY LOSSY. An operation
// that silently drops the archive "when the disk is full enough" is one whose
// reasoning string is true on the day you read it and false on the day it runs
// — and the reasoning string is what the operator approves on. Two names, two
// reasoning strings, one of which says plainly that the contents are gone.
//
// SAFE in the narrow sense that matters here: it writes nothing and creates
// nothing, it truncates the EXISTING INODE in place so pm2 and nginx keep
// writing to the descriptor they already hold, and it no-ops on an
// already-empty file. It is NOT safe in the sense of being undoable —
// reversible: false is the honest flag and the reasoning leads with it.
export const truncateLogUnarchived: SafeListOperation<{ logId: LogId }> = {
  name: 'truncateLogUnarchived',
  summary: 'Truncate a known log file to 0 bytes WITHOUT archiving it — its contents are discarded.',
  reasoning:
    'THE CONTENTS ARE DISCARDED AND CANNOT BE RECOVERED. This is the version to approve when the disk is already full, because truncateLog writes its gzip archive to that same disk and so frees nothing exactly when it matters. This one writes nothing: it truncates the existing inode in place, so pm2 and nginx keep writing to the descriptor they hold and nothing needs a reload. The path is one of eight fixed constants — the operation has no path argument. Approve it only where the free space is worth more than the log.',
  reversible: false,
  // Shorter than truncateLog's hour on purpose: this is the operation reached
  // during a disk emergency, where a second log may need the same treatment
  // minutes later. The cooldown key includes the resolved args (executor.ts),
  // so the eight log ids already damp independently — an hour here would only
  // ever bite the same log twice.
  cooldownMs: 10 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'logId', LOG_IDS);
    return r.ok ? { ok: true, args: { logId: r.args } } : r;
  },
  build(args) {
    const filePath = LOG_FILES[args.logId];
    return built({
      kind: 'node',
      describe: `truncate ${filePath} to 0 bytes in place WITHOUT archiving it (contents discarded)`,
      timeoutMs: 30_000,
      run: async () => {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat) return outcome('', 1, `${filePath} does not exist`);
        if (stat.size === 0) return outcome(`${filePath} is already 0 bytes — nothing to do`);
        await fs.truncate(filePath, 0);
        // Same pre-read caveat as truncateLog: whatever was appended between
        // the stat and the truncate is discarded too, and is not in this count.
        return outcome(`${filePath} truncated to 0 bytes; about ${stat.size} bytes discarded WITHOUT an archive`);
      },
    });
  },
};

// ── 5. reloadNginx ──────────────────────────────────────────────────────────
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

// ── 6. rerunBackup ──────────────────────────────────────────────────────────
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

// ── 7. clearNextCache ───────────────────────────────────────────────────────
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

// ── 8. pruneLogArchives ─────────────────────────────────────────────────────
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

// ── 9. pruneJournal ───────────────────────────────────────────────────────
//
// 🚨 journald FILLING /var IS THE COMMONEST WAY A STOCK UBUNTU BOX RUNS OUT
// OF DISK, AND NOTHING ELSE ON THIS LIST CAN TOUCH IT. The journal is not a
// file truncateLog knows about: it is a set of rotated .journal files under
// /var/log/journal that only journalctl may remove — truncating one by hand
// corrupts the set, and there is no path to add to LOG_FILES that would make
// this safe. So `host-disk` could go critical on journal growth and the whole
// safe list had nothing to offer.
//
// ⚠️ ZERO ARGUMENTS, AND THE SIZE IS A CONSTANT ON PURPOSE. A vacuum target
// is exactly the kind of number that looks harmless as an argument and is not:
// it is the difference between "free some space" and "throw away every log line
// on the box". Fixing it at one value is also what lets the sudoers line below
// match the WHOLE argv, which an enum of sizes could not do in a single line.
//
// ⚠️ THE SECOND, AND ONLY OTHER, SUDOERS LINE THIS LIST NEEDS. Add it beside
// the nginx one, matching the argv exactly, no wildcard:
//     alloutdoor ALL=(root) NOPASSWD: /usr/bin/journalctl --vacuum-size=200M
// `sudo -n` means a missing entry fails closed with "a password is required" on
// stderr rather than hanging on a prompt nobody can answer — a refusal, not a
// hang, and not a silent success. Read that stderr as a PROVISIONING gap, not a
// bug in this operation.
//
// ⚠️ NEITHER LINE HAS A PROVISIONING STEP UNDER infra/ — infra/setup/README.md
// never mentions Warden at all — so the only thing that puts either on the box
// is an operator reading warden/README.md's "Permissions the box needs". Adding
// this operation did not add the line; an operator does.
//
// 🚨 AND THIS NOTE ASSERTED THAT README SECTION CARRIED BOTH LINES WHILE IT
// CARRIED ONLY THE NGINX ONE. The failure that buys: pruneJournal is refused
// the first time it is approved, during the disk emergency it exists for, in
// front of an operator whose code comments told them it was already covered.
// exec/safe-list.test.ts now checks the README for the exact argv of every
// operation that shells out to sudo, so this sentence is enforced rather than
// merely written.
//
// NOT reversible: vacuumed journal entries are gone. What that costs is
// history, never the ability to log — journald starts writing new entries
// immediately and needs no restart.
export const pruneJournal: SafeListOperation<Record<string, never>> = {
  name: 'pruneJournal',
  summary: 'Ask journald to vacuum its own logs down to 200MB.',
  reasoning:
    'journald is the commonest cause of a full /var on a stock Ubuntu box, and it is the one log store nothing else on this list can relieve: its rotated files may only be removed by journalctl, never truncated by hand. This is journald retiring its own oldest entries to a fixed size, the same thing its SystemMaxUse setting does unattended on a box that has one configured. It takes no arguments and the size is a constant, so there is nothing here for a poisoned diagnosis to steer. The entries it retires are gone; new ones keep being written throughout.',
  reversible: false,
  cooldownMs: 60 * 60_000,
  validate: requireNoArgs,
  build() {
    // Absolute path, not `journalctl`: the sudoers line matches a path, and a
    // PATH lookup that resolved somewhere else would fail the sudoers match
    // rather than run — but it would fail confusingly. Name the same file the
    // sudoers line names.
    return built({ kind: 'argv', file: 'sudo', argv: ['-n', '/usr/bin/journalctl', '--vacuum-size=200M'], timeoutMs: 60_000 });
  },
};

// ── 10. pruneNpmCache ─────────────────────────────────────────────────────
//
// npm's content-addressable cache (~/.npm/_cacache for the app user) is pure
// download cache: every entry is re-fetchable from the registry, nothing
// running reads it, and only `npm install` / `npm ci` touch it — which happens
// on a deploy, not during a request. On a box that has built the frontend a few
// dozen times it is routinely the largest thing in the app user's home after
// node_modules.
//
// ⚠️ NEVER node_modules. Deleting those takes the site down until the next
// `npm install`, which is a deploy, not a fix. This operation cannot reach them
// — `npm cache clean` empties _cacache and nothing else — and that is the whole
// reason it is on the list rather than an approved command.
//
// ⚠️ `--force` IS NOT A DANGER FLAG HERE. npm simply refuses `cache clean`
// without it; there is no lesser form of this command to prefer.
export const pruneNpmCache: SafeListOperation<Record<string, never>> = {
  name: 'pruneNpmCache',
  summary: "Empty npm's download cache in the app user's home.",
  reasoning:
    "npm's cache holds only re-downloadable package tarballs and metadata. Nothing running reads it; only a deploy's npm install does, and that refetches whatever it needs. It cannot reach node_modules, so nothing the running site depends on is removed. The worst case of an unnecessary run is a slower next deploy.",
  reversible: true,
  cooldownMs: 6 * 60 * 60_000,
  validate: requireNoArgs,
  build() {
    return built({ kind: 'argv', file: 'npm', argv: ['cache', 'clean', '--force'], timeoutMs: 2 * 60_000 });
  },
};

// ── 11. cancelLongQuery ───────────────────────────────────────────────────
//
// 🚨 THE TWO OPERATIONS BELOW ARE THE ONLY ONES THAT SPEAK TO POSTGRES, AND
// THEY MOVED A BOUNDARY THIS FILE'S HEADER USED TO DRAW ABSOLUTELY. Read the
// narrowed ground rule at the top before adding a third. What they may do is
// end a SESSION. What they may not, and cannot, do: write a row, change a
// setting, install an extension, or signal the postmaster.
//
// ⚠️ THE MODEL NEVER SUPPLIES A PID, AND NEVER SUPPLIES SQL. It picks one of
// three age KEYS; this file holds both the statement and the interval each key
// maps to. A pid chosen elsewhere is precisely the argument that would turn
// "end a stuck session" into "end whichever session the poisoned fact wanted",
// and there is no channel for one.
//
// ⚠️ THE STATEMENT'S GUARDS ARE THE OPERATION. Five are shared; each exists
// because without it the statement reaches something it must not. (cancelLong
// Query carries a SIXTH, the pg_dump exclusion — see its own note.)
//   · datname = current_database()  — never a session in another database on
//     the same cluster.
//   · backend_type = 'client backend' — never autovacuum, the walwriter, the
//     checkpointer or any other background worker. Ending one of those is a
//     Postgres-internals decision this list does not make.
//   · pid <> pg_backend_pid()        — never the psql running the statement.
//   · a state filter                 — see each operation; the two do not
//     overlap, which is why they are two operations.
//   · an age filter                  — a fixed interval, never a computed one.
//
// ⚠️ ROLE, NOT SUPERUSER. pg_cancel_backend / pg_terminate_backend succeed
// when the caller is a member of the target session's role, which Warden's
// DATABASE_URL user is for the app's own connections. Against a session owned
// by someone else Postgres raises a PERMISSION ERROR — and ON_ERROR_STOP=1
// turns that into a non-zero exit carrying Postgres's own words, so it lands in
// the thread as a failed run rather than as a silent nothing-happened. (The
// narrow rule: that is true of a PERMISSION failure. A pid that has already
// gone is a warning and a `f` in the result, which is not a failure and
// correctly does not read as one. Neither was re-verified against the
// Postgres version on the box during this pass.)
//
// ⚠️ AN EMPTY RESULT IS A REAL, COMMON OUTCOME AND MEANS NOTHING MATCHED.
// Exit code 0 with no rows is "no session was that old", not "it worked". The
// two are told apart in the thread by the row text, and only there — this
// operation has no re-check of its own.

/**
 * ⚠️ The ONLY interpolation into SQL in this file, and it is a constant
 * looked up in a frozen map by a key requireEnum has already accepted — the
 * same fencing checks/database.ts's assertPlainKey() puts around the one
 * interpolation it allows. `age` cannot be a string that arrived from outside
 * this module: QueryAge is a member of QUERY_AGES or validate() refused it.
 */
function cancelLongQuerySql(age: QueryAge): string {
  return (
    'select pid::text, pg_cancel_backend(pid)::text from pg_stat_activity ' +
    "where datname = current_database() and backend_type = 'client backend' " +
    "and pid <> pg_backend_pid() and state = 'active' " +
    // rerunBackup's pg_dump identifies itself this way and legitimately runs
    // for many minutes on a database of any size. Cancelling it would turn one
    // recovery operation into a missed backup. coalesce, because a NULL
    // application_name would make a bare <> comparison NULL and quietly drop
    // the row from the result for the opposite reason.
    "and coalesce(application_name, '') <> 'pg_dump' " +
    "and query_start < now() - interval '" + AGE_INTERVAL[age] + "'"
  );
}

// SAFE because pg_cancel_backend ends the STATEMENT, not the connection: the
// session survives, its transaction is rolled back by Postgres atomically, and
// the client sees a query error it can retry. Nothing half-written can be left
// behind — that is the database's guarantee, not ours.
export const cancelLongQuery: SafeListOperation<{ olderThan: QueryAge }> = {
  name: 'cancelLongQuery',
  summary: 'Cancel client queries that have been running longer than a chosen age.',
  reasoning:
    'Cancels the statement, not the connection: the session stays open and Postgres rolls its transaction back atomically, so nothing is half-written and the caller can simply run it again. It only ever reaches client sessions in this database, never a background worker and never the connection issuing the cancel, and it deliberately skips the nightly pg_dump, which legitimately runs for many minutes. The age is one of three fixed intervals and the statement is a constant in the daemon; no pid and no SQL comes from the diagnosis.',
  reversible: true,
  // The damp that matters here is against a re-firing db-long-running check
  // cancelling the same workload on every sweep. ⚠️ The cooldown key
  // includes the resolved args (executor.ts), so picking a different age gets a
  // fresh window — true of truncateLog's log ids too, and a property of the
  // damp rather than of this operation.
  cooldownMs: 5 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'olderThan', QUERY_AGES);
    return r.ok ? { ok: true, args: { olderThan: r.args } } : r;
  },
  build(args) {
    return built(psqlPlan(cancelLongQuerySql(args.olderThan), 20_000));
  },
};

// ── 12. terminateIdleInTransaction ────────────────────────────────────────
//
// A session left `idle in transaction` holds its locks and pins the oldest
// transaction id in the cluster, so vacuum cannot reclaim anything newer than
// it — one forgotten connection is how a small database stops shrinking and a
// lock queue builds behind a row nobody is using. Cancelling does not help: an
// idle session has no statement to cancel, which is why this is a separate
// operation from cancelLongQuery rather than a second state in its filter.
//
// ⚠️ state_change, NOT query_start. For a session sitting idle in a
// transaction, state_change is when it WENT idle — the thing being measured.
// query_start is when its last statement began, which is earlier, so filtering
// on it would terminate a session that has been idle for two seconds because a
// statement it already finished started ten minutes ago.
function terminateIdleInTransactionSql(age: QueryAge): string {
  return (
    'select pid::text, pg_terminate_backend(pid)::text from pg_stat_activity ' +
    "where datname = current_database() and backend_type = 'client backend' " +
    'and pid <> pg_backend_pid() ' +
    "and state in ('idle in transaction', 'idle in transaction (aborted)') " +
    "and state_change < now() - interval '" + AGE_INTERVAL[age] + "'"
  );
}

// NOT reversible, and for a narrower reason than "it kills something": the
// transaction is rolled back atomically, so no committed data is at risk — but
// the SESSION is gone, and with it every temporary table, session setting,
// prepared statement and advisory lock it held. A pooled client reconnects on
// its next query and never notices; anything holding session state does, and
// nothing can restore it.
export const terminateIdleInTransaction: SafeListOperation<{ olderThan: QueryAge }> = {
  name: 'terminateIdleInTransaction',
  summary: 'End client sessions left idle inside a transaction for longer than a chosen age.',
  reasoning:
    'A session left idle in a transaction keeps its locks and pins the oldest transaction id, so vacuum stops reclaiming space and a lock queue builds behind a row nobody is using. Cancelling cannot help it: there is no statement to cancel. Postgres rolls the abandoned transaction back atomically, so no committed data is at risk, but the connection is ended and its session state goes with it. It only ever reaches client sessions in this database, never a background worker and never the connection issuing it. The age is one of three fixed intervals and the statement is a constant in the daemon; no pid and no SQL comes from the diagnosis.',
  reversible: false,
  cooldownMs: 5 * 60_000,
  validate(raw) {
    const r = requireEnum(raw, 'olderThan', QUERY_AGES);
    return r.ok ? { ok: true, args: { olderThan: r.args } } : r;
  },
  build(args) {
    return built(psqlPlan(terminateIdleInTransactionSql(args.olderThan), 20_000));
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
  startProcess,
  truncateLog,
  truncateLogUnarchived,
  reloadNginx,
  rerunBackup,
  clearNextCache,
  pruneLogArchives,
  pruneJournal,
  pruneNpmCache,
  cancelLongQuery,
  terminateIdleInTransaction,
]);

/** Exact-name lookup. ⚠️ Never a prefix, fuzzy or case-insensitive match: the
 *  name arrives from a model's output, and "close enough" is exactly how the
 *  wrong operation gets picked. */
export function findSafeListOperation(name: unknown): SafeListOperation<unknown> | null {
  if (typeof name !== 'string') return null;
  return SAFE_LIST.find((op) => op.name === name) ?? null;
}
