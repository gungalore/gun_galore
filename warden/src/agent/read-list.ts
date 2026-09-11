// warden/src/agent/read-list.ts
//
// THE READ LIST — the five tools Claude may reach for mid-diagnosis, and the
// whole of what it may reach for. Built exactly like exec/safe-list.ts: a
// fixed `name`, a tiny argument shape checked against a closed enum, and a
// `build()` that turns VALIDATED args into a plan. The model picks a NAME and,
// at most, a VALUE FROM A FROZEN TUPLE THIS FILE DEFINES.
//
// ⚠️ THE REGISTRY IS CLOSED AND NOTHING CAN REQUEST A SIXTH. There is no
// "other", no "custom", no escape hatch, and no tool that takes a path, a
// pattern, a pid, a process name or a line of SQL. Prompt injection is
// contained STRUCTURALLY by that closure, not by the model being clever about
// a hostile log line: the worst an injected line achieves is a WRONG DIAGNOSIS
// a human then reads, because every argument below is either a member of a
// frozen tuple, a bounded integer selected by an enum key, or — in exactly one
// named place — a substring consumed by String.includes() inside this package.
//
// ⚠️ WHY A READ NEEDS A SAFETY ARGUMENT AT ALL. A write is obviously dangerous
// and gets a confirm dialog. A read looks free and is not: it is an
// EXFILTRATION channel. Whatever a tool returns lands in the model's context,
// in the diagnosis prose the model then writes, in the Desk thread an operator
// reads, and in the next sweep's prompt. So each entry below carries a
// `reasoning` naming what it can and cannot surface, and two exclusions are
// load-bearing rather than accidental:
//
//   🚨 backend/.env AND frontend/.env.production ARE ABSENT FROM read_file,
//      deliberately. The env-backend / env-frontend checks already answer the
//      question the model actually has — WHICH KEYS ARE SET — through
//      checks/env-manifest.ts, whose header states its own boundary: "A VALUE
//      NEVER LEAVES THIS CHECK". That manifest carries LENGTHS, plus values
//      only for the explicit NON_SECRET_ENV_KEYS allowlist. It is what the
//      model wants ~95% of the time and it cannot leak a value. A read_file
//      that could open those paths would walk straight around that boundary,
//      and exec/audit.ts's redactSecrets() would NOT save it: that function
//      sweeps WARDEN's own process.env, which holds three secrets
//      (WARDEN_TOKEN, ANTHROPIC_API_KEY, DATABASE_URL) because
//      ecosystem.config.cjs ships no env block and env.ts loads only
//      warden/.env. RESEND_API_KEY, PEACH_SECRET, ID_HASH_SECRET and the rest
//      live in backend/.env, are not in Warden's environment, and are
//      invisible to the value sweep — only four shape regexes would stand
//      between them and the prompt. redactSecrets is a net. env-manifest is
//      the boundary. This list stays on the boundary's side of it.
//
//   🚨 query_db IS NAMED QUERIES ONLY. A free-form SELECT from a model is an
//      exfiltration channel with a read-only alibi: `select "idNumber",
//      "phone" from "User"` changes nothing, lands in the thread, the audit
//      store and the next prompt, and redactSecrets() does not know what a
//      South African ID number looks like. It is also a denial-of-service
//      channel (an unbounded join on a live box) and it inverts
//      CheckContext.queryDb's deliberate no-parameter design, whose own note
//      reads: "there is no parameter channel here on purpose, because there is
//      no legitimate caller who needs one". Every statement below is a literal
//      built at module scope from constants this repo wrote, each declares its
//      output COLUMNS, and read-list.test.ts asserts no column and no
//      statement names anything on a PII denylist.
//
// ⚠️ WHAT WAS LEFT OFF, AND WHY — so the next reader does not "fix" a gap:
//   · grepLog(pattern) — a model-composed pattern reaching an argv is the
//     exact failure the invariant exists to make impossible, and an enum of
//     patterns is a worse tail_log.
//   · processDetail(pm2 describe) — checks/pm2.ts already reads `pm2 jlist`
//     every 60 seconds and its evidence is already fenced into the prompt. A
//     tool that re-reads a measured fact spends a turn and a round trip to
//     learn what the model was already told.
//   · anything under SECURE_UPLOAD_DIR by name. `directorySizes` may total it
//     (a number), because host-disk cannot attribute what is eating the disk;
//     `listDirectory` may NOT enumerate it, because the filenames there are
//     metadata about members' identity documents.

import { LOG_FILES, LOG_IDS, type LogId } from '../exec/index.js';
import type { CheckModule, WardenConfig } from '../types.js';
import type { ReadPlan, ReadTool, ReadToolDeps, ReadValidation, ToolInputSchema } from './types.js';

// ── argument validators ─────────────────────────────────────────────────────
//
// ⚠️ A HAND COPY OF exec/safe-list.ts's asPlainObject / requireEnum /
// requireNoArgs, and it has to be: those three are module-private there,
// exec/index.ts does not export them, and this track may not edit exec/. Keep
// the two in step BY HAND — a diff between them is a bug in whichever one
// drifted. The copy is verbatim because the ONE line that matters is a line a
// paraphrase would lose, and losing it has already happened once in this
// package.

/** Rejects arrays and non-objects. An array passes a naive
 *  `typeof === 'object'` check and then reads `raw.fileId` as undefined —
 *  refusing it outright says so, instead of failing later behind a confusing
 *  enum message. */
function asPlainObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * Exact membership in a fixed tuple.
 *
 * ⚠️ LOAD-BEARING: this is an `includes()` on a literal tuple — never
 * `key in someObject`, never a regex over the value. `in` walks the prototype
 * chain, so `__proto__`, `constructor` and `toString` all pass it; a lookup
 * gated that way would accept them, hand back Object.prototype's member
 * instead of a path, and blow up (or worse) inside build(). That is not a
 * hypothetical in this package: the retired src/safety/ copy of the safe list
 * gated on `!(id in LOG_FILES)` and had exactly that hole while its live twin
 * did not. read-list.test.ts pins all three names as refused for every enum'd
 * argument here.
 */
function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): ReadValidation<T> {
  const value = obj[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return { ok: false, error: `${field} must be one of: ${allowed.join(', ')}` };
  }
  return { ok: true, args: value as T };
}

/** Extra keys are REFUSED, not ignored: a smuggled field means whatever
 *  produced this selection misunderstood the tool, and failing loudly surfaces
 *  that rather than reading something the caller believed it had
 *  parameterised. */
function noExtraKeys(obj: Record<string, unknown>, allowed: readonly string[]): string | null {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  return extra.length > 0 ? `unexpected argument(s): ${extra.join(', ')}` : null;
}

/** One enum'd field and nothing else — the shape four of the five tools want. */
function oneEnumArg<T extends string>(raw: unknown, field: string, allowed: readonly T[]): ReadValidation<T> {
  const obj = asPlainObject(raw);
  if (!obj) return { ok: false, error: `expected an object with a "${field}" field; ${field} must be one of: ${allowed.join(', ')}` };
  const picked = requireEnum(obj, field, allowed);
  if (!picked.ok) return picked;
  const extra = noExtraKeys(obj, [field]);
  return extra ? { ok: false, error: extra } : picked;
}

function enumSchema(field: string, allowed: readonly string[], description: string): ToolInputSchema {
  return {
    type: 'object',
    properties: { [field]: { type: 'string', enum: [...allowed], description } },
    required: [field],
    additionalProperties: false,
  };
}

// ── 1. read_file ────────────────────────────────────────────────────────────
//
// A fileId ENUM, NEVER A PATH. Every entry is a configuration or manifest file
// whose whole content is already in git or is a copy of something in git, and
// whose interesting property is DRIFT — what the box has versus what the repo
// says. None of them is a secret store; the two that are (backend/.env,
// frontend/.env.production) are absent by decision, see the header.

export const FILE_IDS = [
  'nginxRepoConf',
  'nginxLiveConf',
  'backupScript',
  'backendPackageJson',
  'frontendPackageJson',
  'pm2Ecosystem',
] as const;
export type FileId = (typeof FILE_IDS)[number];

/**
 * ⚠️ PATHS COME FROM WardenConfig, never from a literal here. This repo
 * disagrees with itself about the box in three places (pm2 process names, the
 * app root, nginx's server_name), and checks/context.ts's header says plainly
 * that a module baking in one guess measures the wrong box and reports "ok".
 * A wrong path here fails CLOSED — ctx.readFile returns a stated error, which
 * the model receives as a refusal, never as an empty file.
 */
export function fileTargets(config: WardenConfig): Readonly<Record<FileId, string>> {
  return Object.freeze({
    nginxRepoConf: config.nginxRepoConfPath,
    // The live copy nginx is actually serving. checks/nginx-proxy-timeout
    // diffs it against the repo one; this lets the model read either side of
    // that diff when the check says they disagree.
    nginxLiveConf: `${config.nginxSitesEnabledDir}/alloutdoor.conf`,
    // checks/backup-set-gap already reads this file's TEXT to decide what the
    // nightly run covers. Reading it whole is how the model tells "the CIP
    // directory is not in the tar" from "the script no longer runs at all".
    backupScript: config.backupScriptPath,
    backendPackageJson: `${config.appRoot}/backend/package.json`,
    frontendPackageJson: `${config.appRoot}/frontend/package.json`,
    pm2Ecosystem: `${config.appRoot}/infra/pm2/ecosystem.config.js`,
  });
}

/** A config file, not a corpus. Anything larger than this is not one of the
 *  six and the box is lying about a path; refuse rather than pull a megabyte
 *  into the model's context. */
const MAX_FILE_BYTES = 256 * 1024;

/**
 * 🚨 read_file DOES NOT RETURN A FILE WHOLE, AND ITS DESCRIPTION USED TO SAY
 * IT DID. The result is capped at runner.ts's MAX_TOOL_OUTPUT_BYTES (5,000
 * bytes), which has to stay under fence.ts's 6,000-CHARACTER MAX_BLOCK_LEN so
 * that exactly one truncation can ever apply. Three of the six ids are bigger
 * than that on the production box — nginx.conf ~15KB, backup.sh ~11KB,
 * ecosystem.config.js ~8.5KB — and what a single 5,000-byte slice drops is
 * exactly the content each id is on this list FOR: nginx's proxy timeouts sit
 * around byte 11,127, backup.sh's CIP lines around byte 9,071. A model told
 * "whole" and handed the first 5,000 bytes would conclude the timeouts are
 * absent from a file that sets them.
 *
 * So the tool PAGES, and says so. ⚠️ THE MODEL PICKS A KEY, THIS FILE PICKS
 * THE NUMBER — the same TAIL_DEPTHS / AGE_INTERVAL pattern. The narrow claim
 * that buys: the `part` in a ReadPlan is a constant read out of the map below
 * by a key that already passed requireEnum, never a number parsed from or
 * computed on what the model sent. runner.ts does arithmetic on that constant
 * to find a byte range; it never does arithmetic on model text.
 *
 * ⚠️ SIX PARTS IS NOT EVERY FILE UNDER MAX_FILE_BYTES. 6 × 4,500 = 27,000
 * bytes is comfortably past the largest of the six ids, but MAX_FILE_BYTES is
 * 256KB, so a file between 27KB and 256KB has a tail this enum cannot name.
 * That gap is NOT closed here — it is announced: runner.ts's last reachable
 * part states how many bytes remain unread, because a page that simply ended
 * would read as the end of the file.
 */
const FILE_PART_KEYS = ['1', '2', '3', '4', '5', '6'] as const;
type FilePartKey = (typeof FILE_PART_KEYS)[number];

const FILE_PARTS: Readonly<Record<FilePartKey, number>> = Object.freeze({
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
});

/** Bytes per part. Under MAX_TOOL_OUTPUT_BYTES with room for runner.ts's own
 *  one-line part header, so a part is never cut a second time by
 *  prepareOutput() and never a third time by the fencer. */
const FILE_PART_BYTES = 4_500;

export const readFileTool: ReadTool<{ fileId: FileId; part: number }> = {
  name: 'read_file',
  summary: `Read one of six fixed configuration files on the box, ${FILE_PART_BYTES} bytes at a time — pick the part.`,
  reasoning:
    'Every id resolves to a configuration or manifest file whose content is already in git or is the box\'s copy of something in git, so the finding is drift rather than a disclosure. There is no path argument: the id is a member of a frozen tuple and the path comes from WardenConfig. The result is PAGED — one fixed-size part per call, never the entire file — because a tool result is capped well below the size of the larger configuration files and a silent cut would hide the very lines these ids exist to reach; each part states which part it is, of how many, and whether anything is left. backend/.env and frontend/.env.production are deliberately not on the list — the env checks already report which keys are set, as lengths plus an allowlist, and that boundary is the reason a secret has never reached this prompt.',
  schema: () => ({
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        enum: [...FILE_IDS],
        description: 'Which of the six fixed files to read. There is no path argument and no other file is reachable.',
      },
      part: {
        type: 'string',
        enum: [...FILE_PART_KEYS],
        description: `Optional, default "1". Which ${FILE_PART_BYTES}-byte part of the file to return. Files are NOT returned whole: each result says which part it is, of how many, so ask again with the next part when the one you want is further in.`,
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  }),
  validate: (raw) => {
    const obj = asPlainObject(raw);
    if (!obj) return { ok: false, error: `expected an object with a "fileId" field; fileId must be one of: ${FILE_IDS.join(', ')}` };
    const extra = noExtraKeys(obj, ['fileId', 'part']);
    if (extra) return { ok: false, error: extra };

    const fileId = requireEnum(obj, 'fileId', FILE_IDS);
    if (!fileId.ok) return fileId;

    // Absent and null both mean part 1 — the whole point of a default is that
    // a model asking the obvious question does not have to know about paging
    // before its first read.
    if (obj.part === undefined || obj.part === null) return { ok: true, args: { fileId: fileId.args, part: FILE_PARTS['1'] } };
    const part = requireEnum(obj, 'part', FILE_PART_KEYS);
    if (!part.ok) return part;
    return { ok: true, args: { fileId: fileId.args, part: FILE_PARTS[part.args] } };
  },
  build: (args, deps): ReadPlan => ({
    kind: 'file',
    path: fileTargets(deps.ctx.config)[args.fileId],
    maxBytes: MAX_FILE_BYTES,
    part: args.part,
    partBytes: FILE_PART_BYTES,
    maxParts: FILE_PART_KEYS.length,
  }),
};

// ── 2. tail_log ─────────────────────────────────────────────────────────────
//
// ⚠️ LOG_IDS IS IMPORTED FROM exec/safe-list.ts VERBATIM, not re-declared.
// READ and TRUNCATE must never disagree about which files exist: a seventh id
// here that truncateLog does not know, or a warden-own log there that this
// cannot read, is a gap that reads as complete from either side. That is not
// hypothetical either — the same enum shipped with six ids and read complete
// while Warden could relieve every log on the box except its own.

/** ⚠️ THE MODEL SUPPLIES THE KEY; THIS FILE SUPPLIES THE VALUE — exactly the
 *  AGE_INTERVAL pattern in exec/safe-list.ts, and the only reason a number is
 *  allowed into an argv at all. No arithmetic on anything the model sent, and
 *  no route from `args` into the argv that does not pass through this map. */
export const TAIL_DEPTHS = ['short', 'medium', 'deep'] as const;
export type TailDepth = (typeof TAIL_DEPTHS)[number];

const TAIL_LINES: Readonly<Record<TailDepth, number>> = Object.freeze({
  short: 200,
  // checks/nginx-error-log and checks/pm2-crash-output tail a fixed small
  // window each sweep. `deep` is the one thing tail_log adds that no check
  // has: a look further back than the window the checks are pinned to.
  medium: 1_000,
  deep: 5_000,
});

/** Long enough for a request path, a stack frame or an error code; short
 *  enough that it cannot itself be a payload. */
const MAX_CONTAINS_LEN = 80;

export const tailLogTool: ReadTool<{ logId: LogId; depth: TailDepth; contains: string | null }> = {
  name: 'tail_log',
  summary: 'Tail one of the eight known log files, optionally keeping only lines containing a plain substring.',
  reasoning:
    'The log ids are exec/safe-list.ts\'s own LOG_IDS, imported rather than copied, so the set Warden can read and the set it can truncate cannot drift apart. The path comes from LOG_FILES by an enum key — there is no path argument. The line count is one of three constants in this file selected by an enum key. The substring filter is applied with String.includes() over text already in memory: it never becomes a regular expression, never reaches grep, and never reaches an argv.',
  schema: () => ({
    type: 'object',
    properties: {
      logId: { type: 'string', enum: [...LOG_IDS], description: 'Which log. There is no path argument.' },
      depth: {
        type: 'string',
        enum: [...TAIL_DEPTHS],
        description: 'How far back: short 200 lines, medium 1000, deep 5000. Prefer short unless a check says the window it reads was already full.',
      },
      contains: {
        type: 'string',
        description:
          'Optional. A PLAIN SUBSTRING (not a pattern, not a regular expression) — only lines containing it are returned. Up to 80 characters.',
      },
    },
    required: ['logId', 'depth'],
    additionalProperties: false,
  }),
  validate: (raw) => {
    const obj = asPlainObject(raw);
    if (!obj) return { ok: false, error: `expected an object with "logId" and "depth"; logId must be one of: ${LOG_IDS.join(', ')}` };
    const extra = noExtraKeys(obj, ['logId', 'depth', 'contains']);
    if (extra) return { ok: false, error: extra };

    const logId = requireEnum(obj, 'logId', LOG_IDS);
    if (!logId.ok) return logId;
    const depth = requireEnum(obj, 'depth', TAIL_DEPTHS);
    if (!depth.ok) return depth;

    // `contains` is optional. Absent and null both mean "no filter"; anything
    // that is neither absent nor a string is a mistake worth naming rather
    // than silently ignoring.
    const rawContains = obj.contains;
    let contains: string | null = null;
    if (rawContains !== undefined && rawContains !== null) {
      if (typeof rawContains !== 'string') return { ok: false, error: 'contains must be a plain substring (a string) if present' };
      // Control characters cannot occur in a log line we would want to match
      // and are the one thing that could corrupt the fenced block this text
      // is about to be echoed into. Stripped, not refused — a stray \t in a
      // pasted token should narrow the search, not fail it.
      const cleaned = rawContains.replace(/[\x00-\x1F\x7F]+/g, ' ').trim().slice(0, MAX_CONTAINS_LEN);
      if (!cleaned) return { ok: false, error: 'contains was empty once control characters were removed; omit it instead' };
      contains = cleaned;
    }
    return { ok: true, args: { logId: logId.args, depth: depth.args, contains } };
  },
  build: (args): ReadPlan => ({
    kind: 'tail',
    file: 'tail',
    argv: ['-n', String(TAIL_LINES[args.depth]), LOG_FILES[args.logId]],
    contains: args.contains,
    timeoutMs: 10_000,
  }),
};

// ── 3. run_read_command ─────────────────────────────────────────────────────
//
// A READ_LIST built exactly like SAFE_LIST: each entry is a named operation
// with its own validate() and its own argv, and run_read_command's job is only
// to find one by EXACT name and delegate. ⚠️ Exact, never prefix, never fuzzy,
// never case-insensitive — the same rule findSafeListOperation states, for the
// same reason: a near-match resolved generously is a different command than
// the one whose safety argument was reviewed.
//
// ⚠️ NO SHELL PLAN IS REACHABLE HERE, and that is a property of the TYPE
// rather than of anyone's care: ReadPlan has no `shell` arm. exec/proc.ts's
// ExecPlan does, and only executor.runApprovedProposal() may build one — a
// command an operator personally read, byte for byte, in the Desk's confirm.
// read-list.test.ts asserts at runtime that every entry below builds an `argv`
// plan, because a `kind` string can be widened by the same edit that widens
// the type.

export const DU_DIRS = ['appRoot', 'backupDir', 'secureUploads', 'cipSheets', 'varLog', 'nextCache'] as const;
export type DuDir = (typeof DU_DIRS)[number];

export const LS_DIRS = ['backupDir', 'migrations', 'nginxSitesEnabled', 'wardenArchive'] as const;
export type LsDir = (typeof LS_DIRS)[number];

function duPath(config: WardenConfig, dir: DuDir): string {
  switch (dir) {
    case 'appRoot':
      return config.appRoot;
    case 'backupDir':
      return config.backupDir;
    // ⚠️ TOTALLED, NEVER ENUMERATED. This is the encrypted identity-document
    // tree. `du -s` yields one number, which is what disk attribution needs;
    // `ls` would yield filenames, which are metadata about members, which is
    // why secureUploads is absent from LS_DIRS.
    case 'secureUploads':
      return config.secureUploadDir;
    case 'cipSheets':
      return config.cipSheetsDir;
    case 'varLog':
      return '/var/log';
    case 'nextCache':
      return `${config.appRoot}/frontend/.next/cache`;
  }
}

function lsPath(config: WardenConfig, dir: LsDir): string {
  switch (dir) {
    case 'backupDir':
      return config.backupDir;
    case 'migrations':
      return config.prismaMigrationsDir;
    case 'nginxSitesEnabled':
      return config.nginxSitesEnabledDir;
    // exec/safe-list.ts's truncateLog gzips here before truncating. Its own
    // note records that this sits INSIDE the git working tree.
    case 'wardenArchive':
      return `${config.appRoot}/warden-archive`;
  }
}

export interface ReadCommand<Args = unknown> {
  name: string;
  summary: string;
  reasoning: string;
  validate(raw: unknown): ReadValidation<Args>;
  build(args: Args, deps: ReadToolDeps): ReadPlan;
}

/**
 * `du` with -x so it stops at the mount boundary and -d 1 so it answers with a
 * handful of lines rather than a filesystem walk.
 *
 * WHAT THIS ADDS THAT NO CHECK HAS: attribution. checks/host-disk measures how
 * FULL each mount is and its growth rate; nothing anywhere says WHICH
 * directory is eating it. The one partial overlap is stated rather than
 * hidden: checks/backup-set-gap already runs `du -sb` over the CIP directory,
 * so `cipSheets` here is a second reading of a measured fact — kept because
 * omitting one id from a size enum is how an enum starts reading complete
 * while having a hole in it.
 */
const directorySizes: ReadCommand<{ dir: DuDir }> = {
  name: 'directorySizes',
  summary: 'Total the immediate children of one of six fixed directories, so the disk can be attributed.',
  reasoning:
    'host-disk says a mount is 94% full and nothing on the board says what filled it. -x stops at the mount boundary and -d 1 bounds the output to a handful of lines. The directory is a member of a frozen tuple resolved through WardenConfig — never a path. Sizes only: the encrypted secure-upload tree may be TOTALLED here and may not be listed anywhere.',
  validate: (raw) => {
    const picked = oneEnumArg(raw, 'dir', DU_DIRS);
    return picked.ok ? { ok: true, args: { dir: picked.args } } : picked;
  },
  build: (args, deps): ReadPlan => ({
    kind: 'argv',
    file: 'du',
    argv: ['-x', '-h', '-d', '1', duPath(deps.ctx.config, args.dir)],
    timeoutMs: 20_000,
  }),
};

/**
 * WHAT THIS ADDS: names and timestamps the checks summarise away.
 * checks/backup-artifacts stats the backup tree and reports an age and a size;
 * when it says "the newest dump is 40 hours old" the next question is which
 * files are actually there, and that question currently has no answer on the
 * board.
 */
const listDirectory: ReadCommand<{ dir: LsDir }> = {
  name: 'listDirectory',
  summary: 'List one of four fixed directories with sizes and modification times.',
  reasoning:
    'Answers the question that follows every backup and migration finding — which files are actually there — with names and dates the summarising checks drop. The four directories hold backup artefacts, migration folders, nginx site files and Warden\'s own log archive: none holds member content. The encrypted secure-upload tree is deliberately not among them, because its FILENAMES are metadata about members even though its bytes are unreadable.',
  validate: (raw) => {
    const picked = oneEnumArg(raw, 'dir', LS_DIRS);
    return picked.ok ? { ok: true, args: { dir: picked.args } } : picked;
  },
  build: (args, deps): ReadPlan => ({
    kind: 'argv',
    file: 'ls',
    argv: ['-la', '--time-style=long-iso', lsPath(deps.ctx.config, args.dir)],
    timeoutMs: 15_000,
  }),
};

/**
 * WHAT THIS ADDS: everything on the box that is not one of the two pm2 apps.
 * checks/pm2-processes reads `pm2 jlist` and knows about alloutdoor-backend,
 * alloutdoor-frontend and warden. When host-memory says the box is swapping
 * and pm2 says all three processes are within their ceilings, the thing eating
 * the memory is by definition something no check can see — a runaway psql, a
 * left-over `next build`, a pg_dump that never exited.
 *
 * ⚠️ NO `args` COLUMN, AND THE COST IS REAL. Including the full command line
 * would make two node processes tellable apart, which is the most useful thing
 * ps could say here. It is left out because a command line is the one place a
 * credential can sit in plain sight on a box, and redactSecrets() is a net
 * (four shape regexes plus a sweep of WARDEN's own three env values), not a
 * boundary. The gap this leaves: `comm` says "node" for every Node process, so
 * this tool can say the box is running four node processes and cannot say
 * which scripts they are.
 */
const processTable: ReadCommand<Record<string, never>> = {
  name: 'processTable',
  // ⚠️ NOT "the top 20". `ps` has no count flag and an argv plan cannot pipe
  // to head — a pipe needs a shell, which is the one thing this list may not
  // reach. So the table is SORTED heaviest-first and whatever does not fit the
  // runner's output cap is cut there, with the cut stated. Saying "the 20
  // heaviest" would be a claim the argv does not make.
  summary: 'Every process on the box by resident memory, heaviest first, without their command lines.',
  reasoning:
    'The only tool that can see a process pm2 does not manage, which is the whole answer when host-memory is bad and every pm2 process is inside its ceiling. It is sorted heaviest-first rather than limited, because limiting it would need a pipe and a pipe would need a shell; the tail of the list is cut by the output cap and says so. Command lines are excluded on purpose: they are where a credential sits in plain sight, and the redactor is a net rather than a boundary. The cost is that every Node process reads as "node".',
  validate: (raw) => {
    if (raw === undefined || raw === null) return { ok: true, args: {} };
    const obj = asPlainObject(raw);
    if (!obj) return { ok: false, error: 'takes no arguments; expected {} or nothing' };
    const extra = noExtraKeys(obj, []);
    return extra ? { ok: false, error: extra } : { ok: true, args: {} };
  },
  build: (): ReadPlan => ({
    kind: 'argv',
    file: 'ps',
    // `--sort=-rss` and the column list are this file's literals. `-o` takes
    // one fixed string; nothing here is assembled from an argument.
    argv: ['-eo', 'pid,ppid,rss,etimes,stat,comm', '--sort=-rss'],
    timeoutMs: 15_000,
  }),
};

export const READ_COMMANDS: readonly ReadCommand<never>[] = Object.freeze([
  directorySizes,
  listDirectory,
  processTable,
] as unknown as ReadCommand<never>[]);

/** ⚠️ EXACT name match. Never prefix, never fuzzy, never case-insensitive —
 *  the rule exec/safe-list.ts's findSafeListOperation states, copied because a
 *  generously-resolved near-match is a different command than the one whose
 *  safety argument was reviewed. */
export function findReadCommand(name: string): ReadCommand<never> | null {
  return READ_COMMANDS.find((c) => c.name === name) ?? null;
}

export const runReadCommandTool: ReadTool<{ command: string; args: unknown }> = {
  name: 'run_read_command',
  summary: 'Run one of three fixed read-only commands on the box.',
  reasoning:
    'The same shape as the write-side safe list — a fixed name, a closed argument enum, an argv assembled here — with the write half removed. Every entry builds an argv plan; ReadPlan has no shell arm for one to build, so there is no command text anywhere in this path for anything to smuggle into.',
  schema: () => ({
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: READ_COMMANDS.map((c) => c.name),
        description: READ_COMMANDS.map((c) => `${c.name}: ${c.summary}`).join(' | '),
      },
      args: {
        type: 'object',
        description:
          'The command\'s own argument, if it takes one. directorySizes takes {"dir": one of ' +
          DU_DIRS.join(', ') +
          '}; listDirectory takes {"dir": one of ' +
          LS_DIRS.join(', ') +
          '}; processTable takes none.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  }),
  validate: (raw) => {
    const obj = asPlainObject(raw);
    if (!obj) return { ok: false, error: `expected an object with a "command" field; command must be one of: ${READ_COMMANDS.map((c) => c.name).join(', ')}` };
    const extra = noExtraKeys(obj, ['command', 'args']);
    if (extra) return { ok: false, error: extra };
    const name = obj.command;
    if (typeof name !== 'string') return { ok: false, error: `command must be one of: ${READ_COMMANDS.map((c) => c.name).join(', ')}` };
    const command = findReadCommand(name);
    if (!command) return { ok: false, error: `no read command named "${name.slice(0, 40)}"; command must be one of: ${READ_COMMANDS.map((c) => c.name).join(', ')}` };
    // ⚠️ The delegated validate() IS the gate for the inner argument, exactly
    // as SafeListOperation.validate is on the write side. Nothing here
    // re-checks what it accepted and nothing here accepts what it refused.
    const inner = command.validate(obj.args);
    return inner.ok ? { ok: true, args: { command: name, args: inner.args } } : inner;
  },
  build: (args, deps): ReadPlan => {
    const command = findReadCommand(args.command);
    // Unreachable: validate() refused an unknown name above, and build() is
    // only ever called with args validate() returned. Kept because the
    // alternative to a stated impossibility is a non-null assertion that
    // silently becomes a crash if the two ever drift.
    if (!command) return { kind: 'argv', file: 'false', argv: [], timeoutMs: 1_000 };
    return command.build(args.args as never, deps);
  },
};

// ── 4. query_db ─────────────────────────────────────────────────────────────
//
// 🚨 NAMED QUERIES ONLY. See the header for why a free-form SELECT is an
// exfiltration channel with a read-only alibi. Each entry below is a literal
// assembled at module scope from constants this repo wrote, declares its
// output COLUMNS, and is bounded by a LIMIT this file wrote.
//
// ⚠️ EVERY STATEMENT READS A POSTGRES CATALOG OR STATISTICS VIEW, OR
// _prisma_migrations. Not one of them reads an application table, and none of
// them selects `query`, `client_addr` or any application column. That is the
// property read-list.test.ts checks against a PII denylist — column names AND
// statement text — so a fifth query that reached into "User" fails the build
// rather than shipping.

export const QUERY_IDS = ['tableSizes', 'vacuumBacklog', 'migrationTail', 'connectionActivity'] as const;
export type QueryId = (typeof QUERY_IDS)[number];

export interface NamedQuery {
  summary: string;
  /** Declared so the result can be rendered with a header, and so the PII
   *  denylist has something to check other than the raw statement. */
  columns: readonly string[];
  sql: string;
  maxRows: number;
  timeoutMs: number;
}

export const NAMED_QUERIES: Readonly<Record<QueryId, NamedQuery>> = Object.freeze({
  // checks/db-size measures the WHOLE database and its growth rate. When that
  // goes bad the next question is which table, and nothing answers it.
  tableSizes: {
    summary: 'The 20 largest tables by total size, including indexes and TOAST.',
    columns: ['schema', 'table', 'total_size'],
    sql:
      'select schemaname, relname, pg_size_pretty(pg_total_relation_size(relid)) ' +
      'from pg_catalog.pg_statio_user_tables ' +
      'order by pg_total_relation_size(relid) desc limit 20',
    maxRows: 20,
    timeoutMs: 15_000,
  },
  // Nothing on the board measures autovacuum at all. A table with millions of
  // dead tuples and no autovacuum in weeks is the shape of a slow-query
  // finding whose cause is invisible from the query side.
  vacuumBacklog: {
    summary: 'Tables with the most dead tuples, and when autovacuum last touched them.',
    columns: ['schema', 'table', 'live_tuples', 'dead_tuples', 'last_autovacuum', 'last_autoanalyze'],
    sql:
      'select schemaname, relname, n_live_tup, n_dead_tup, coalesce(last_autovacuum::text, \'never\'), coalesce(last_autoanalyze::text, \'never\') ' +
      'from pg_catalog.pg_stat_user_tables ' +
      'order by n_dead_tup desc limit 20',
    maxRows: 20,
    timeoutMs: 15_000,
  },
  // checks/db-migration-drift reports a COUNT mismatch between the table and
  // the migrations directory. It cannot say which migration, or whether one
  // was rolled back — and "64 applied, 65 on disk" is a very different
  // incident depending on which.
  migrationTail: {
    summary: 'The last 15 Prisma migrations, newest first, with their applied and rolled-back state.',
    columns: ['migration', 'started_at', 'finished_at', 'applied_steps', 'rolled_back_at'],
    sql:
      'select migration_name, started_at::text, coalesce(finished_at::text, \'unfinished\'), applied_steps_count::text, coalesce(rolled_back_at::text, \'-\') ' +
      'from "_prisma_migrations" order by started_at desc limit 15',
    maxRows: 15,
    timeoutMs: 15_000,
  },
  // checks/db-connections counts sessions against max_connections.
  // ⚠️ THE `query` COLUMN IS DELIBERATELY NOT SELECTED. checks/db-long-running
  // already surfaces left(query,160) under its own reviewed framing; widening
  // that to every session in the pool would put member-derived literals from
  // arbitrary statements into the prompt for no diagnostic gain.
  connectionActivity: {
    summary: 'Open database sessions grouped by application and state, with the age of the oldest in each group.',
    columns: ['application', 'state', 'sessions', 'oldest_state_change'],
    sql:
      'select coalesce(nullif(application_name, \'\'), \'(unnamed)\'), coalesce(state, \'(none)\'), count(*)::text, coalesce(min(state_change)::text, \'-\') ' +
      'from pg_catalog.pg_stat_activity group by 1, 2 order by count(*) desc limit 20',
    maxRows: 20,
    timeoutMs: 15_000,
  },
});

export const queryDbTool: ReadTool<{ queryId: QueryId }> = {
  name: 'query_db',
  summary: 'Run one of four fixed, named, read-only database queries.',
  reasoning:
    'There is no SQL argument and no parameter channel — the same deliberate absence CheckContext.queryDb declares, for the same reason. Each statement is a literal built at module scope, reads only a Postgres catalog or statistics view (or _prisma_migrations), declares its output columns, and carries its own LIMIT. A test asserts that neither a column name nor a statement names anything on a PII denylist, so a query reaching into an application table fails the build rather than shipping.',
  schema: () =>
    enumSchema(
      'queryId',
      QUERY_IDS,
      'Which named query. ' + QUERY_IDS.map((id) => `${id}: ${NAMED_QUERIES[id].summary}`).join(' | '),
    ),
  validate: (raw) => {
    const picked = oneEnumArg(raw, 'queryId', QUERY_IDS);
    return picked.ok ? { ok: true, args: { queryId: picked.args } } : picked;
  },
  build: (args): ReadPlan => {
    const q = NAMED_QUERIES[args.queryId];
    return { kind: 'query', sql: q.sql, columns: q.columns, maxRows: q.maxRows, timeoutMs: q.timeoutMs };
  },
};

// ── 5. recheck_now ──────────────────────────────────────────────────────────
//
// THE FIFTH TOOL, and the case for it. Everything else on this list reads
// something no check reads. This one re-runs a check that has ALREADY run, and
// that is the point: every fact in the prompt is ONE SAMPLE. A single reading
// cannot tell a spike from a trend, and it cannot tell "still true" from "was
// true four minutes ago" — which is precisely the question after a pm2 restart
// count, a load average or a connection count. The engine already carries rows
// forward with `fresh: false` and the prompt already says NOT RE-MEASURED THIS
// SWEEP; this is the only way the model can do anything about reading that.
//
// ⚠️ NO NEW MEASUREMENT CODE. It calls engine.runOne(check, ctx) — the same
// function "re-check after a fix" uses, with both of the engine's guards (a
// try/catch and a per-cost timeout) and the same "an unknown is never a zero"
// stamping. A check that throws comes back as ITS OWN unknown with a reason,
// never as an error the loop has to interpret.
//
// ⚠️ THE COST, NAMED: a check's cadence exists to keep a sweep cheap on a box
// that serves a live site, and this walks past the cadence. An `expensive`
// check has a 60s default budget, so the loop's per-turn and whole-loop
// budgets — not this tool — are what stop a model from ordering twelve of
// them. Those live in loop.ts and are the reason it is safe to leave every
// check id on the enum rather than hiding the expensive ones, which would put
// a hole in an enum that reads complete.

export const recheckNowTool: ReadTool<{ checkId: string }> = {
  name: 'recheck_now',
  summary: 'Re-run one registered check right now and return its fresh result.',
  reasoning:
    'Every fact in the prompt is a single sample, so nothing in it can distinguish a spike from a trend or "still true" from "was true when the cadence last came round". This re-runs one check through the same engine.runOne() the post-fix re-check uses, with the engine\'s own timeout and its own rule that a check which measured nothing reports unknown rather than zero. It adds no measurement code and can reach nothing a scheduled sweep does not already reach.',
  schema: () => ({
    type: 'object',
    properties: {
      checkId: {
        type: 'string',
        description: 'The id of a registered check, exactly as it appears in the MEASURED FACTS section.',
      },
    },
    required: ['checkId'],
    additionalProperties: false,
  }),
  // ⚠️ The enum for this one is not a literal in this file — it is the
  // registry, which is the only place it can be without immediately drifting
  // from it. validate() is handed the registry through the same deps every
  // build() gets, so the published set and the gate are one list.
  validate: (raw) => {
    const obj = asPlainObject(raw);
    if (!obj) return { ok: false, error: 'expected an object with a "checkId" field' };
    const extra = noExtraKeys(obj, ['checkId']);
    if (extra) return { ok: false, error: extra };
    const value = obj.checkId;
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
      return { ok: false, error: 'checkId must be the id of a registered check' };
    }
    return { ok: true, args: { checkId: value } };
  },
  build: (args): ReadPlan => ({ kind: 'recheck', checkId: args.checkId }),
};

/**
 * recheck_now's membership test, which cannot be a frozen tuple in this file
 * without becoming a second copy of checks/registry.ts. Applied in runner.ts
 * after validate(), against the injected registry — exact match, never fuzzy,
 * same rule as findReadCommand.
 */
export function findCheckById(checks: readonly CheckModule[], id: string): CheckModule | null {
  return checks.find((c) => c.id === id) ?? null;
}

// ── the registry ────────────────────────────────────────────────────────────

/** ⚠️ CLOSED. Five entries, frozen, and nothing can ask for a sixth: the
 *  Anthropic request carries exactly these schemas, runner.ts resolves a name
 *  against exactly this list by exact match, and a name that is not on it
 *  comes back as a refusal the model can read — never as an execution. */
export const READ_LIST: readonly ReadTool<never>[] = Object.freeze([
  readFileTool,
  tailLogTool,
  runReadCommandTool,
  queryDbTool,
  recheckNowTool,
] as unknown as ReadTool<never>[]);

/** ⚠️ EXACT name match, for the same reason findSafeListOperation is exact. */
export function findReadTool(name: string): ReadTool<never> | null {
  return READ_LIST.find((t) => t.name === name) ?? null;
}

/**
 * The human-readable line for a plan, DERIVED from the plan rather than
 * written beside it — the describePlan() discipline from exec/proc.ts, for the
 * same reason: "the read you asked for is the read that ran" then holds by
 * construction instead of by a template somebody has to keep in sync. This is
 * what goes on the fenced result's `source:` line.
 */
export function describeReadPlan(plan: ReadPlan): string {
  switch (plan.kind) {
    case 'argv':
      return [plan.file, ...plan.argv].join(' ');
    case 'tail':
      return [plan.file, ...plan.argv].join(' ') + (plan.contains ? ` (kept only lines containing "${plan.contains}")` : '');
    case 'file':
      // The part belongs in the source line: two reads of the same id differ
      // only by it, and "the read you asked for is the read that ran" has to
      // hold for the second one too.
      return `read ${plan.path} (part ${plan.part})`;
    case 'query':
      return `psql -c ${plan.sql}`;
    case 'recheck':
      return `re-run warden check "${plan.checkId}"`;
  }
}
