/**
 * WARDEN — the wire contract between this API and the Warden panel.
 *
 * ⚠️ WARDEN DOES NOT RUN IN THIS PROCESS AND CANNOT. Everything the board
 * wants from it — disk, SSL expiry, nginx 5xx, backup freshness, a pm2
 * reload — lives on the box, not in a Node request handler. A measurement
 * the daemon could not take comes back `unknown` with its reason, never a
 * plausible zero. This module keeps that promise: it is the AUTHENTICATED
 * DOOR to a Warden daemon, never a second implementation of one.
 *
 * That split is not tidiness. "Approve the fix…" ends in a command running on
 * a production box. If this process held the command and the shell, an admin
 * JWT would be a remote shell for a firearms marketplace. Warden owns its own
 * safe list and runs inside it; this API can only ask, and only for a
 * proposal Warden itself raised.
 *
 * Mirrors what frontend/components/admin/warden-thread.tsx renders. The six
 * message kinds below are that component's `WARDEN_KINDS` union verbatim — a
 * seventh kind invented here renders as `undefined` tag and throws in the
 * browser, with no error on either side of the wire. warden.spec.ts reads the
 * daemon's own warden/src/types.ts and both frontend copies to hold the mirror.
 */

/** Verbatim from frontend/components/admin/warden-thread.tsx WARDEN_KINDS. Do not extend one side alone. */
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
  /**
   * The daemon's SAFE-LIST OPERATION NAME behind `command`, or null when the
   * model drafted the command free-hand — the `approved_command` path the run
   * log on the Agent surface already renders by that name.
   *
   * 🚨 THE CONFIRM DIALOG STATED THE SAFE LIST FOR EVERY PROPOSAL, INCLUDING
   * THE ONES IT DID NOT COVER. "It runs inside Warden's own safe list — this
   * browser and this API never hold the shell" is two claims welded together:
   * the second is always true, the first only when this field is non-null.
   * The daemon knew which was which (StoredProposal.operation) and
   * projectProposal() dropped it before the wire, so the Desk could not tell
   * an enum-bounded operation from a string the model wrote.
   *
   * ⚠️ NO ARGS, HERE OR ANYWHERE. Approve is a compare-and-swap on the
   * command STRING; the daemon re-resolves and re-validates the arguments
   * from its own store at approve time. The name is what an operator can
   * check against the menu — the args would only be an executor input sitting
   * in a browser.
   *
   * ⚠️ ABSENT DEGRADES TO null, WHICH IS THE LOUDER READING. A daemon too old
   * to send this makes every proposal read as free-form and un-bounded, which
   * over-warns. The friendlier default would print "safe list" over a command
   * nothing on either side validated, which is the failure this closes.
   */
  operationName: string | null;
  /**
   * Whether what this runs can be put back. Rendered on the confirm, never
   * inferred from the command text.
   *
   * ⚠️ ANYTHING BUT AN EXPLICIT true IS false. Phase 11 took the daemon's
   * irreversible operation count from 2 to 5, and the sharp pair is
   * `cancelLongQuery` against `terminateIdleInTransaction` — one
   * `pg_cancel_backend` vs `pg_terminate_backend` inside a 354-character
   * statement, one of which leaves the session alive and one of which does
   * not. An operator at 2am must not have to find that by reading SQL.
   */
  reversible: boolean;
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
  /**
   * WHICH absence this is, when `present` is false. Null when it is present.
   *
   * 🚨 `present: false` COVERS TWO OPPOSITE EPISTEMIC STATES AND THE DESK WAS
   * READING BOTH AS ONE. `not_deployed` — no WARDEN_BASE_URL/WARDEN_TOKEN, so
   * no daemon exists, so nothing can be waiting on the operator and saying so
   * is true. `unreachable` — a daemon IS configured and did not answer, so
   * NOTHING WAS READ: whether a proposal is waiting is unknown, and the
   * approval queue's "Nothing is waiting on you, because nothing is watching
   * the box" is then a claim about a list this process never saw. That is the
   * same class of statement as an audit trail dropping records silently.
   *
   * `note` already differed between the two cases, but it is prose written
   * for a human to read; a surface that has to decide what to SAY needs a
   * discriminator it can branch on, not a sentence it has to match.
   *
   * ⚠️ THE UNKNOWN READING IS THE SAFE DEFAULT. A client too old to read this
   * field, or one that cannot tell, must fall back to "this is not a reading
   * of the daemon" rather than to "all clear".
   */
  absence: 'not_deployed' | 'unreachable' | null;
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
 * One row of the daemon's own check board (`GET /gates` on Warden itself).
 *
 * This is a measurement Warden took on the box: what was found when somebody
 * looked. It is NOT a config value — a row that reads `unknown` beside a real
 * reason means the daemon could not look, never that the thing is fine.
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
 * so the null sailed through behind a non-null declaration and every reader
 * of `counts.bad` got a TypeError on a freshly-restarted daemon.
 *
 * It is non-null here because normaliseCheckBoard() now FILLS it — every key
 * present, tallied from the rows when the daemon sent none. That is not an
 * invented zero: the rows are the measurement, and a row that has never been
 * run carries status 'unknown', which is what it counts as.
 */
export interface WardenCheckBoard {
  lastCheckAt: string | null;
  counts: { ok: number; warn: number; bad: number; unknown: number };
  /**
   * ⚠️ ROWS THE DAEMON SENT THAT THIS API COULD NOT NAME — not a daemon
   * field, and not part of `counts`. The counts are re-tallied from the rows
   * that survived normalisation, so without this number a row with an
   * unnameable status would disappear from both and the board would quietly
   * UNDER-report: a red gate that stopped being counted looks exactly like a
   * red gate that cleared. `counts.unknown` is a different claim — the daemon
   * measuring nothing yet — and must not absorb these.
   */
  dropped: number;
  rows: WardenCheckRow[];
  /** Present so a board full of green tiles cannot hide that proposals are
   *  suspended. Null means not paused. */
  paused: WardenPause | null;
}

/**
 * What `GET /admin/warden/board` answers.
 *
 * ⚠️ A NULL BOARD IS THREE DIFFERENT FACTS, SO THEY ARE SAID OUT LOUD. An
 * absent daemon (`not_deployed`), one that did not answer (`unreachable`) and
 * one that answered with something unreadable all used to collapse to the
 * same `null` — and a surface that renders "all clear" over any of them is
 * reporting a board it never saw. `present` is the discriminator; `absence`
 * names which absence it is when `present` is false, exactly as `WardenChat`
 * does. A client too old to read it must fall back to "this is not a reading
 * of the daemon", never to "the box is fine".
 */
export interface WardenBoardView {
  present: boolean;
  absence: 'not_deployed' | 'unreachable' | null;
  note?: string;
  board: WardenCheckBoard | null;
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
   * How many runs the operator cannot see on this page — records this proxy
   * REFUSED to show because they failed the wire rules above, PLUS the
   * records the daemon refused to send in the first place.
   *
   * ⚠️ IT IS A SUM ACROSS BOTH SIDES OF THE WIRE, AND IT HAS TO BE. The
   * daemon's own projectAudit() drops a record whose trigger or operation
   * kind it cannot name — the same rule, for the same reason — and for a
   * while it counted those only into its pm2 stdout. A record dropped over
   * there never reached this list at all, so the number this response carried
   * was
   * the half of the gap that happened to be ours. `WardenAuditView.dropped`
   * on warden/src/types.ts carries the daemon's half; auditTrail() adds them.
   * A daemon too old to send the field contributes 0, which under-states the
   * gap rather than inventing one.
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
