/**
 * WARDEN — the wire contract between this API and the Site surface.
 *
 * ⚠️ WARDEN DOES NOT RUN IN THIS PROCESS AND CANNOT. Everything the Site
 * board wants from it — disk, SSL expiry, nginx 5xx, backup freshness, a pm2
 * reload — lives on the box, not in a Node request handler. DeskSiteService
 * already says so on its face and returns `known: false` rather than a
 * plausible zero. This module keeps that promise: it is the AUTHENTICATED
 * DOOR to a Warden daemon, never a second implementation of one.
 *
 * That split is not tidiness. "Approve the fix…" ends in a command running on
 * a production box. If this process held the command and the shell, an admin
 * JWT would be a remote shell for a firearms marketplace. Warden owns its own
 * safe list and runs inside it; this API can only ask, and only for a
 * proposal Warden itself raised.
 *
 * Mirrors what frontend/components/desk/chat.tsx already renders. The six
 * message kinds below are that component's `WardenKind` union verbatim — a
 * seventh kind invented here renders as `undefined` tag and throws in the
 * browser, with no error on either side of the wire.
 */

/** Verbatim from frontend/components/desk/chat.tsx KIND_TAG. Do not extend one side alone. */
export const WARDEN_MESSAGE_KINDS = [
  'finding',
  'fixed',
  'red-gate',
  'proposal',
  'ran',
  'note',
] as const;
export type WardenMessageKind = (typeof WARDEN_MESSAGE_KINDS)[number];

/**
 * A code block in the thread. `inset` is a proposal's dry run (what WOULD
 * happen); `ground` is the transcript of something that already ran. The
 * design gives them different grounds precisely so the two are never confused
 * at a glance.
 */
export interface WardenPre {
  tone: 'inset' | 'ground';
  lines: string[];
}

export interface WardenChatMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenMessageKind;
  /** ISO-8601. The client formats; the server never guesses a timezone. */
  at: string;
  /** Paragraphs, already split. Warden writes prose, not markdown. */
  body: string[];
  pre?: WardenPre;
  /** Set when this message carries the face of a proposal the operator can act on. */
  proposalId?: string;
  /** The "approved 08:53" line under a settled proposal. */
  footnote?: string;
}

/**
 * `red_gate` is a proposal only in the sense that it arrives on the same
 * thread. It has no command, cannot be approved, cannot be declined and
 * cannot be sunk — the only thing that clears it is the gate changing in
 * code. See WardenService.approve/decline, which refuse it by kind.
 */
export type WardenProposalKind = 'proposal' | 'red_gate';
export type WardenProposalStatus = 'pending' | 'approved' | 'declined' | 'acknowledged';

export interface WardenProposal {
  id: string;
  kind: WardenProposalKind;
  status: WardenProposalStatus;
  headline: string;
  diagnosis: string;
  /**
   * EXACTLY what "Approve the fix…" will run, as Warden will run it. The
   * money-grade confirm restates this string and the approve call echoes it
   * back for a compare-and-swap — see WardenService.approve. Null for a red
   * gate, which has nothing to run.
   */
  command: string | null;
  /** For a red gate: which config gate it mirrors, so the two agree. */
  gateKey: string | null;
  raisedAt: string;
}

export interface WardenChat {
  /**
   * False when WARDEN_BASE_URL / WARDEN_TOKEN are unset. The board draws the
   * "not deployed" state; it does NOT draw an empty, healthy-looking thread,
   * because a quiet Warden and an absent Warden look identical and mean
   * opposite things.
   */
  present: boolean;
  note?: string;
  /** When Warden last completed a sweep. Null while unknown — never `now`. */
  lastCheckAt: string | null;
  messages: WardenChatMessage[];
  proposals: WardenProposal[];
  /**
   * ⚠️ ON THE THREAD, NOT ONLY ON THE BOARD, AND FOR THE SAME REASON
   * `present` IS. A paused Warden says nothing new, which is exactly what a
   * healthy one with nothing to report also does. Without this field the
   * chat panel cannot tell the operator which of the two they are looking at.
   * Null means not paused.
   */
  paused: WardenPause | null;
}

/**
 * Warden is holding off on DIAGNOSIS and PROPOSALS until `until`.
 *
 * ⚠️ HAND-MIRRORED from warden/src/types.ts. Change one, change the other.
 *
 * ⚠️ MEASUREMENT IS NOT PAUSED. The daemon keeps sweeping on the same cadence
 * and keeps announcing what turns; what stops is the model call and any new
 * proposal. Copy that says Warden is "stopped" or "off" would be wrong, and
 * the operator would read a stale board as a live one.
 *
 * ⚠️ IT ALWAYS EXPIRES — the daemon caps it at 24 hours and refuses an
 * open-ended pause. A pause nobody comes back to resume is a watchdog
 * silently switched off for a month.
 */
export interface WardenPause {
  /** ISO-8601. Past this instant the pause is over, resume or no resume. */
  until: string;
  /** ISO-8601, when it was set. */
  since: string;
  operatorId: string | null;
  reason: string | null;
}

/**
 * A config gate with the one fact DeskSiteService does not carry: whether it
 * is red, and therefore deals a Warden card onto the Desk every day until it
 * changes. The gate values themselves still come from DeskSiteService so the
 * Site board and this endpoint can never disagree about what PAYMENTS_LIVE is.
 */
export interface WardenGate {
  key: string;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  note?: string;
  /** tone === 'bad'. A red gate nags daily and can never be sunk. */
  red: boolean;
}

export interface WardenGatesView {
  gates: WardenGate[];
  redCount: number;
}

/**
 * One row of the Settings panel — THE ONLY FOUR. `kind` tells the client
 * which widget to draw; nothing here is a generic settings editor.
 *
 * ⚠️ WRITES DO NOT COME BACK THROUGH THIS MODULE. PATCH /admin/settings is
 * the one write path, with its type validation, its danger-flag reason
 * minimum and its audit row. A second writer would be a second set of those
 * rules, and the one that drifted would be the one nobody was reading.
 */
export interface WardenSettingRow {
  key: string;
  label: string;
  kind: 'phone' | 'checkboxes' | 'toggle';
  /** Board-safe rendering. For the phone this is MASKED and there is no raw. */
  display: string;
  /** Present only where the value is not personal data: a flag, a type list. */
  raw?: string;
  items?: { value: string; label: string; checked: boolean }[];
  /** True when PATCH /admin/settings accepts it. Never a claim this panel writes it. */
  editable: boolean;
  note: string;
}

export interface WardenSettingsView {
  rows: WardenSettingRow[];
}

/**
 * One row of the daemon's own check board (`GET /gates` on Warden itself).
 *
 * ⚠️ NOT WardenGate. That one is the Site board's CONFIG gates — env values
 * this process reads for itself. This is a measurement Warden took on the
 * box, and the two are one word apart in the UI and completely different
 * facts: a config gate says what a variable is set to, a check row says what
 * was found when somebody looked.
 */
export interface WardenCheckRow {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'bad' | 'unknown';
  /**
   * The sentence the operator reads. For an `unknown` this is the REASON it
   * could not be measured — "cannot read /var/log/nginx/access.log:
   * Permission denied" — never a hedge, and never a zero.
   */
  verdict: string;
  gateKey: string | null;
  standing: boolean;
  measuredAt: string;
  fresh: boolean;
}

/**
 * The daemon's measured board, AFTER normalisation.
 *
 * 🚨 `counts` IS NON-NULL HERE AND NULLABLE ON THE DAEMON'S SIDE, AND THAT
 * DIFFERENCE WAS A LIVE CRASH. WardenCore.gates() returns `counts: null`
 * until the first sweep completes — a daemon restarted ninety seconds ago has
 * measured nothing, and four zeroes would render as a clean board on an
 * unwatched box. checkBoard() used to cast the response straight to this type
 * after a single `Array.isArray(board?.rows)` check, which `rows: []` passes,
 * so the null sailed through behind a non-null declaration and
 * DeskSiteService.board() read `warden.counts.bad` off it. That is a
 * TypeError on the Site page every time the daemon is restarted.
 *
 * It is non-null here because normaliseCheckBoard() now FILLS it — every key
 * present, tallied from the rows when the daemon sent none. That is not an
 * invented zero: the rows are the measurement, and a row that has never been
 * run carries status 'unknown', which is what it counts as.
 */
export interface WardenCheckBoard {
  lastCheckAt: string | null;
  counts: { ok: number; warn: number; bad: number; unknown: number };
  rows: WardenCheckRow[];
  /** Present so a board full of green tiles cannot hide that proposals are
   *  suspended. Null means not paused. */
  paused: WardenPause | null;
}

/**
 * ONE EXECUTION, as the operator may read it.
 *
 * ⚠️ HAND-MIRRORED from warden/src/types.ts (`WardenAuditEntry`).
 *
 * 🚨 THIS IS THE ONLY WAY A RUN IS READABLE AFTER THE FACT. The daemon has
 * always written these records — operation, resolved args, exit code, and the
 * redacted verbatim transcript — and until Phase 4 served them to nobody:
 * WardenStore.auditFor() had only test callers, no daemon route returned one,
 * and the operator's single view of a run was its `ran` chat message, which
 * ages out of a 600-record on-disk window and the 200-record wire window
 * below. "What has this agent run on the production box" was a question you
 * answered by SSH-ing in.
 *
 * ⚠️ REDACTION HAPPENS IN THE DAEMON, BEFORE PERSISTENCE, AND BEFORE
 * TRUNCATION — so a secret cannot sit across a cut boundary. `redactions`
 * names what fired, never a value. Nothing on this side may undo that;
 * normalisation here only narrows further.
 */
export interface WardenAuditEntry {
  id: string;
  /** May be empty for a record whose proposal id did not survive validation.
   *  Empty means "no link to follow", never "no proposal". */
  proposalId: string;
  at: string;
  finishedAt: string;
  durationMs: number;
  /** `unattended` — the daemon's own safe list, no human. `operator_approved`
   *  — through the compare-and-swap on the exact command someone read. */
  trigger: 'unattended' | 'operator_approved';
  operatorId: string | null;
  operationKind: 'safe_list' | 'approved_command';
  operationName: string | null;
  /** The EXACT command that ran. */
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: WardenTruncatedText;
  stderr: WardenTruncatedText;
  /** NAMES of what was redacted, never values. Empty when nothing fired,
   *  never absent — a reader must not have to wonder whether redaction ran. */
  redactions: string[];
  /** ⚠️ null means NOBODY LOOKED YET. That is a different claim from
   *  `{ result: 'unknown' }`, which means looked and could not tell. */
  recheck: { at: string; result: 'ok' | 'still-bad' | 'unknown'; note: string } | null;
}

export interface WardenTruncatedText {
  text: string;
  truncated: boolean;
  /** Size BEFORE any truncation — the real output size, not the size of what
   *  survived. A reader can see how much was withheld. */
  originalBytes: number;
}

export interface WardenAuditView {
  present: boolean;
  note?: string;
  entries: WardenAuditEntry[];
  /** True when older records exist that this page did not carry. */
  truncated: boolean;
  /**
   * How many records the daemon sent that this proxy REFUSED to show,
   * because they failed the wire rules above.
   *
   * 🚨 THIS EXISTS BECAUSE A SILENT DROP IS A FALSE ALIBI. The normaliser
   * skips anything it cannot name — an unknown trigger, an unknown
   * operationKind, an empty command — and without a counter those runs simply
   * were not in the list, while `truncated` (which only ever carries the
   * daemon's own paging flag) went on saying false. An INCOMPLETE record of
   * what executed on the production box then looked exactly like a complete
   * one. On a firearms marketplace that is the difference between "the agent
   * ran nothing else" and "I cannot see what else the agent ran".
   *
   * ⚠️ NOT the same thing as `truncated`, and must never be folded into it.
   * Truncated means "there is more, ask for the next page"; dropped means
   * "there is more and I cannot render it, so go and read the daemon's own
   * store". The fixes are different — one is a click, the other is ssh.
   *
   * The trigger is field-vocabulary skew across the hand-mirror: deploy.sh
   * ships warden as a separate, explicitly NON-FATAL third stage, so a daemon
   * that deployed beside a backend that did not is a real window, not a
   * hypothetical one.
   */
  dropped: number;
}

/** What POST /admin/warden/sweep answers. */
export interface WardenSweepResult {
  /**
   * ⚠️ FALSE IS NOT A FAILURE. The sweep was started and is still running;
   * the daemon answered early rather than letting the request outlive nginx's
   * 60s cut, which would give the operator a 502 while the box was being
   * measured behind it. The board lands by itself and GET /gates will show it.
   */
  finished: boolean;
  /** False when this call joined a cadence sweep already in flight rather
   *  than starting a forced one — some of those rows are carried forward, and
   *  calling that a full re-measure would be the same lie by another route. */
  forced: boolean;
  joined: boolean;
  board: WardenCheckBoard;
}
