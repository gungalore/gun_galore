// warden/src/types.ts
//
// The scaffold's shared vocabulary: what a CHECK is, what a check may
// return, and the narrow set of primitives a check is allowed to touch the
// world through. Two rules are enforced HERE, in the type system, rather
// than left to each check author's discipline — because both failures are
// silent and this daemon exists to stop silent failures:
//
//   1. UNKNOWN CARRIES ITS REASON. `CheckOutcome` is a discriminated union
//      in which the `unknown` arm has NO `verdict` field and a REQUIRED
//      `reason`. You cannot write an unknown that reads like a
//      measurement, and you cannot write one that doesn't say why.
//
//   2. NOTHING THROWS AT A CHECK. Every accessor on `CheckContext` returns
//      `Attempt<T>` — a failure is a VALUE the check must branch on, never
//      an exception and never an empty result. A `readFile` that threw
//      would be caught somewhere and become `''`; a `queryDb` that threw
//      would become `[]`; and `[]` reads as "zero rows, all clear". That
//      is precisely the plausible-zero this design exists to avoid, so the
//      shapes make it un-writable rather than merely discouraged.
//
// (The engine still wraps every check in try/catch — see engine.ts. That
// is the backstop for a genuine bug, not the primary mechanism.)

import type { RunOutcome } from './proc.js';

// ── check results ───────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export const CHECK_STATUSES: readonly CheckStatus[] = ['ok', 'warn', 'bad', 'unknown'] as const;

/**
 * One measured number, path or string, with the command that produced it.
 * `from` is what makes a board row auditable — the operator can re-run it
 * by hand and get the same answer. It is the command as run (argv joined
 * for reading), never a template with a placeholder left in.
 */
export interface Evidence {
  label: string;
  value: string;
  from?: string;
}

export type CheckCost = 'cheap' | 'moderate' | 'expensive';

/**
 * What a check's `run()` hands back. The engine stamps id/title/timing on
 * top of this — a check never states its own id twice.
 *
 * ⚠️ The `unknown` arm deliberately has no `verdict`. The engine renders
 * one from `reason` ("Not measured — …") so an unmeasured row can never
 * be phrased as a finding.
 */
export type CheckOutcome =
  | {
      status: 'ok' | 'warn' | 'bad';
      /** ONE line, plain prose, no markdown. What is true, in words. */
      verdict: string;
      evidence: Evidence[];
      /**
       * A fact that no command Warden runs can resolve — it clears only
       * when a human changes a file, a config or a credential. The CIP
       * backup gap is the canonical one. A standing result becomes a RED
       * GATE upstream (no command, cannot be approved or dismissed), never
       * a proposal.
       */
      standing?: boolean;
      gateKey?: string | null;
    }
  | {
      status: 'unknown';
      /**
       * REQUIRED. Why this could not be measured, in the same voice as a
       * verdict. "psql exited 2: connection refused", not "error".
       */
      reason: string;
      /** Anything that WAS measurable before the wall. Often empty. */
      evidence?: Evidence[];
      gateKey?: string | null;
    };

/** A check result after the engine has stamped identity and timing on it. */
export interface CheckResult {
  id: string;
  title: string;
  cost: CheckCost;
  status: CheckStatus;
  /** ONE line. For an unknown, rendered from `reason` by the engine. */
  verdict: string;
  evidence: Evidence[];
  /**
   * Always present, `null` when the status is not unknown — never omitted.
   * Same discipline as the audit record's `redactions: []`: the absence of
   * a reason must be a stated absence, not a missing key.
   */
  reason: string | null;
  standing: boolean;
  gateKey: string | null;
  measuredAt: string;
  durationMs: number;
  /**
   * False when the row was carried forward from an earlier sweep because
   * the check was not due yet (see cadence). The board must be able to say
   * "measured 40 minutes ago" rather than implying every row is live.
   */
  fresh: boolean;
}

export interface CheckModule {
  /** Stable, kebab-case, used as a history-series prefix and a board key. */
  id: string;
  title: string;
  cost: CheckCost;
  /**
   * Minimum gap between two runs. The engine skips a check that is not due
   * and carries its previous result forward. Cheap checks run often;
   * expensive ones (anything shelling out repeatedly or scanning a log)
   * declare minutes, not seconds.
   */
  cadenceMs: number;
  /**
   * Hard ceiling for this check. The engine abandons the check at this
   * point and records an unknown — a hung `psql` must never hold the sweep
   * open, because GET /chat's 8s budget is served from the sweep's cache
   * and a sweep that never finishes never refreshes that cache.
   */
  timeoutMs?: number;
  run(ctx: CheckContext): Promise<CheckOutcome>;
}

export interface Sweep {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: CheckResult[];
  /** Every status key present, zero where none — never a sparse object. */
  counts: Record<CheckStatus, number>;
}

// ── the world, through a keyhole ────────────────────────────────────────

/**
 * Success or a stated failure. Never a thrown exception, never a silently
 * empty success. See the header of this file for why this is a type and
 * not a convention.
 */
export type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

export function attempt<T>(value: T): Attempt<T> {
  return { ok: true, value };
}

export function failed<T = never>(error: string): Attempt<T> {
  return { ok: false, error };
}

export interface FileStat {
  path: string;
  sizeBytes: number;
  /** ISO-8601. */
  mtime: string;
  isDirectory: boolean;
}

export interface TlsCertInfo {
  subject: string;
  issuer: string;
  /** ISO-8601. */
  validFrom: string;
  validTo: string;
}

export interface TlsChainInfo {
  /** The leaf first, then each issuer the server actually sent. */
  chain: TlsCertInfo[];
  /** What Node's own verifier made of the chain as served. */
  authorized: boolean;
  authorizationError: string | null;
  protocol: string | null;
}

export interface HttpJsonResponse {
  status: number;
  body: unknown;
}

export interface HistorySample {
  /** ISO-8601. */
  at: string;
  value: number;
}

/**
 * Warden's own memory of prior readings. `df` and `pm2 jlist` are
 * point-in-time facts: a growth rate or a "restarts are climbing" verdict
 * does not exist without this. A store with one sample must say so (see
 * ratePerDay in checks/history.ts) rather than report a rate of zero.
 */
export interface HistoryStore {
  record(series: string, value: number, at: Date): Promise<void>;
  /** Newest last. */
  recent(series: string, limit?: number): Promise<HistorySample[]>;
}

/**
 * Every path, host and process name Warden touches, resolved ONCE from env
 * with a documented default — never hardcoded at a call site. Three
 * separate doc-vs-repo-vs-live naming drifts already exist in this repo
 * (pm2 process names, app root, nginx server_name), so a check that
 * hardcodes one guess silently measures the wrong box.
 */
export interface WardenConfig {
  /** The deploy checkout Warden sits beside — its repo copies are what the
   *  live-vs-repo drift checks diff against. */
  repoRoot: string;
  appRoot: string;
  backendEnvPath: string;
  frontendEnvPath: string;
  nginxRepoConfPath: string;
  nginxSitesEnabledDir: string;
  nginxAccessLog: string;
  nginxErrorLog: string;
  backupScriptPath: string;
  backupDir: string;
  /** Covered by the nightly backup. */
  secureUploadDir: string;
  /** NOT covered by the nightly backup — see checks/backups.ts. */
  cipSheetsDir: string;
  prismaMigrationsDir: string;
  /** Public hostname to open a TLS connection to for the edge cert. */
  publicHost: string;
  /** Loopback base for the API's own secret-gated health endpoints. */
  apiBaseUrl: string;
  pm2Processes: readonly string[];
  /** name -> max_memory_restart in bytes, from infra/pm2/ecosystem.config.js. */
  pm2MemoryCeilings: Readonly<Record<string, number>>;
  /** Where the growth-rate history file lives. */
  historyPath: string;
}

/**
 * The ONLY way a check touches anything outside its own module. Injected,
 * so every check is testable on a Windows dev box with no Postgres, no
 * nginx and no pm2 anywhere — which is the whole reason the measurement
 * layer can be tested at all.
 */
export interface CheckContext {
  now(): Date;
  config: WardenConfig;
  /** execFile, argv array, never a shell. See src/proc.ts. */
  run(file: string, args: string[], opts?: { timeoutMs?: number; cwd?: string }): Promise<RunOutcome>;
  readFile(path: string): Promise<Attempt<string>>;
  stat(path: string): Promise<Attempt<FileStat>>;
  listDir(path: string): Promise<Attempt<string[]>>;
  /**
   * A FIXED SQL literal from this file tree. Never a string built from a
   * measured fact, a member's text or a model's output — there is no
   * parameter channel here on purpose, because there is no legitimate
   * caller who needs one.
   */
  queryDb(sql: string, opts?: { timeoutMs?: number }): Promise<Attempt<string[][]>>;
  httpGetJson(url: string, opts?: { timeoutMs?: number }): Promise<Attempt<HttpJsonResponse>>;
  tlsChain(host: string, port: number, opts?: { timeoutMs?: number }): Promise<Attempt<TlsChainInfo>>;
  cpuCount(): number;
  history: HistoryStore;
}

// ── the wire contract, mirrored ─────────────────────────────────────────
//
// ⚠️ HAND-MIRRORED from backend/src/desk/warden.types.ts, which is the
// authority and is asserted by backend/src/desk/warden.spec.ts. warden/
// has no import path into backend/src, so these two copies are kept in
// step by hand. If you change one, change the other in the same commit.
//
// 🚨 THE TWO SPELLINGS ARE DIFFERENT ON PURPOSE AND ARE EASY TO TRANSPOSE:
// a chat MESSAGE kind is 'red-gate' (HYPHEN); a PROPOSAL kind is
// 'red_gate' (UNDERSCORE). The backend DROPS a message whose kind is not
// one of the six literals — silently, with no error on either side of the
// wire — so a transposed one simply vanishes from the operator's thread.

export const WARDEN_MESSAGE_KINDS = ['finding', 'fixed', 'red-gate', 'proposal', 'ran', 'note'] as const;
export type WardenMessageKind = (typeof WARDEN_MESSAGE_KINDS)[number];

export interface WardenPre {
  /** 'ground' = this actually ran (a real transcript). 'inset' = it did not. */
  tone: 'inset' | 'ground';
  lines: string[];
}

export interface WardenChatMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenMessageKind;
  at: string;
  /** Paragraphs of plain prose — NOT markdown; the Desk renders it as text. */
  body: string[];
  pre?: WardenPre;
  proposalId?: string;
  footnote?: string;
}

export type WardenProposalKind = 'proposal' | 'red_gate';
export type WardenProposalStatus = 'pending' | 'approved' | 'declined' | 'acknowledged';

export interface WardenProposal {
  id: string;
  kind: WardenProposalKind;
  status: WardenProposalStatus;
  headline: string;
  diagnosis: string;
  /** MUST be null for kind 'red_gate'. The backend forces it, but a red
   *  gate that carried a command would be an approvable red gate, so never
   *  rely on that. */
  command: string | null;
  gateKey: string | null;
  raisedAt: string;
}

/** The id charset the backend validates BEFORE it will call the daemon at
 *  all — an id outside it makes a proposal unreachable for approve or
 *  decline. Anything generating ids must stay inside this. */
export const WARDEN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ── the OBSERVABILITY half of the wire, mirrored ────────────────────────
//
// ⚠️ EVERY SHAPE BELOW IS HAND-MIRRORED IN backend/src/desk/warden.types.ts,
// exactly like the block above it, and for the same reason: warden/ has no
// import path into backend/src. Change one, change the other in the same
// commit. backend/src/desk/warden.spec.ts reads THIS FILE off disk and
// asserts the two kind lists and the id charset still agree, because the
// previous divergence — the backend holding PROPOSAL_ID_RE as a private
// const while this file held WARDEN_ID_RE — was invisible to both sides and
// would have made ids silently unreachable for approve and decline.

/**
 * One row of the measured board — what GET /gates and POST /sweep return.
 *
 * ⚠️ THIS USED TO LIVE IN state/core.ts AS `GateRow`, OUTSIDE THE MIRRORED
 * BLOCK, PINNED BY NO TEST ON EITHER SIDE. Its backend twin is
 * WardenCheckRow and the two agreed only by luck; adding a field to one was
 * completely silent. It is here so the mirror test can see it.
 *
 * ⚠️ NOT the backend's `WardenGate`. That one is a CONFIG gate — what an env
 * var is set to. This is a MEASUREMENT — what was found when somebody
 * looked. They are one word apart in the UI and are different facts.
 */
export interface WardenCheckRow {
  id: string;
  title: string;
  status: CheckStatus;
  /** For an `unknown`, this is the REASON it could not be measured. Never a
   *  hedge, never a zero. */
  verdict: string;
  gateKey: string | null;
  standing: boolean;
  measuredAt: string;
  fresh: boolean;
}

export interface WardenCheckBoard {
  lastCheckAt: string | null;
  /**
   * ⚠️ NULL UNTIL THE FIRST SWEEP FINISHES, AND THAT IS NOT ZERO OF
   * EVERYTHING. A freshly-restarted daemon has measured nothing; a counts
   * object of four zeroes would render as a clean board on an unwatched box.
   * The backend's own copy was declared NON-nullable while this side already
   * returned null, and DeskSiteService.board() reads `warden.counts.bad`
   * straight off it — so the two disagreeing was a TypeError on the Site
   * page every time the daemon was restarted. The backend now fills a
   * complete counts object during normalisation rather than trusting this.
   */
  counts: Record<CheckStatus, number> | null;
  rows: WardenCheckRow[];
  /** Present so a board cannot look healthy while proposals are suspended. */
  paused: WardenPause | null;
}

/**
 * Warden is holding off on DIAGNOSIS and PROPOSALS until `until`.
 *
 * ⚠️ MEASUREMENT IS NOT PAUSED AND MUST NEVER BE. A Warden that stops
 * measuring while paused is a Warden reporting health it has not checked —
 * the board would freeze at whatever it said when the operator hit pause and
 * nothing would say so. What a pause buys is silence from the model and no
 * new buttons, not a blind box.
 *
 * ⚠️ IT ALWAYS EXPIRES. A pause with no end is a daemon somebody turned off
 * in an incident and nobody turned back on, which reads for weeks as "Warden
 * has nothing to say".
 */
export interface WardenPause {
  /** ISO-8601. Past this instant the pause is over, with or without a resume. */
  until: string;
  /** ISO-8601, when it was set. */
  since: string;
  /** The admin who set it. Null for a pause restored from an older state file. */
  operatorId: string | null;
  reason: string | null;
}

/** Command output as it reaches the wire: redacted at capture, truncated at
 *  capture, then clamped again for the wire. */
export interface WardenTruncatedText {
  text: string;
  truncated: boolean;
  /** The size of the output BEFORE any truncation, so a reader can see how
   *  much was withheld rather than wondering whether this is all of it. */
  originalBytes: number;
}

/**
 * One execution, as the operator may read it.
 *
 * 🚨 THIS IS THE ONLY WAY AN EXECUTION IS READABLE AFTER THE FACT. Before
 * this shape existed the audit trail was written to warden-state/state.json
 * and served by NOTHING — `WardenStore.auditFor()` had only test callers, and
 * the operator's single view of a run was the `ran` chat message, which ages
 * out of a 600-record on-disk window and a 200-record wire window. On a
 * firearms marketplace, "what did the agent run on the box last month" was
 * answerable only by SSH-ing in and reading a JSON file.
 *
 * ⚠️ `operation.args` IS DELIBERATELY ABSENT. `command` is built from those
 * args by the same describe() the executor runs, so the args are already
 * visible in it — and every field on the wire is a field two files have to
 * keep in step by hand.
 */
export interface WardenAuditEntry {
  id: string;
  proposalId: string;
  /** When the command started. */
  at: string;
  /** When it finished, was killed on timeout, or errored. */
  finishedAt: string;
  durationMs: number;
  /** `unattended` — the safe list, no human. `operator_approved` — through
   *  the compare-and-swap on the exact command an operator read. */
  trigger: 'unattended' | 'operator_approved';
  operatorId: string | null;
  operationKind: 'safe_list' | 'approved_command';
  /** Safe-list operation name; null for an approved command, which has no
   *  named operation — only a string a human read. */
  operationName: string | null;
  /** The EXACT command that ran. */
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: WardenTruncatedText;
  stderr: WardenTruncatedText;
  /** NAMES of what was redacted — an env var key, or a pattern class — never
   *  a value. Empty when nothing fired, never absent: a reader must not have
   *  to wonder whether redaction ran at all. */
  redactions: string[];
  /** ⚠️ null means NOBODY HAS LOOKED YET, which is a different claim from
   *  `{result:'unknown'}` — "looked and could not tell". */
  recheck: { at: string; result: 'ok' | 'still-bad' | 'unknown'; note: string } | null;
}

export interface WardenAuditView {
  entries: WardenAuditEntry[];
  /** True when older records exist that this page did not carry. */
  truncated: boolean;
  /**
   * How many stored records projectAudit() REFUSED to put on the wire,
   * because it could not name their `trigger` or their `operation.kind`.
   *
   * 🚨 WITHOUT THIS FIELD THE REFUSAL WAS INVISIBLE TO EVERYONE WHO MATTERS.
   * The drop itself is right — a record whose attribution we cannot read must
   * never be coerced into "a human approved this command on the production
   * box" — and core.ts audit() did tally the nulls and raise onError. But
   * onError goes to the DAEMON'S pm2 stdout and nowhere else, so every reader
   * of this wire got a shorter list and `truncated: false`, and an incomplete
   * account of what executed on the box looked exactly like a complete one.
   * The gap was "said out loud" only to somebody already SSH-ed in reading
   * `pm2 logs warden`.
   *
   * ⚠️ NOT `truncated`, and it must never be folded into it. Truncated means
   * "there is more, ask for the next page"; dropped means "there is more and
   * I would not render it, so go and read state.json". One is a click, the
   * other is ssh.
   *
   * ⚠️ THE BACKEND ADDS ITS OWN COUNT TO THIS ONE. warden.service.ts
   * auditTrail() drops records too, on its own rules, and reports the SUM. Do
   * not assume a `dropped` read off that API is this number alone.
   *
   * ⚠️ AND NO SCREEN RENDERS IT YET. Nothing under frontend/ calls
   * GET /admin/warden/audit at all, so the honest total currently reaches an
   * HTTP response and a log line and stops. Whoever builds that panel must
   * print `dropped` SEPARATELY from `truncated` — folding them into one
   * "incomplete" badge loses the only thing that tells the operator whether
   * the fix is another page or an ssh session.
   */
  dropped: number;
}
