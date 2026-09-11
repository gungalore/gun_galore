/**
 * THE DESK — what the chrome knows, and the difference between a zero and a
 * silence.
 *
 * The four tabs carry counts: how many things are on the pile, how many gates
 * are red, how many proposals Warden is waiting on. That is the whole reason
 * the shell polls at all — without it an operator standing on Health has no
 * way of learning that something landed on Now, and the only way to find out
 * is to press the tab and look.
 *
 * 🚨 ZERO AND "I COULD NOT ASK" ARE DIFFERENT ANSWERS AND THEY ARE ACTED ON
 * DIFFERENTLY. A zero means stand down. A failed read means the count on
 * screen is whatever was true a minute ago, and the operator should go and
 * look. So a reading is `number` and no reading is `null`, they are never
 * collapsed, and nothing here ever substitutes 0 for null — the Desk has
 * already shipped that bug once in the other direction, when `site` defaulted
 * to a green "Healthy" no probe had produced and read OK straight through an
 * outage (see DeskShellProps.site).
 *
 * ⚠️ A THIRD STATE, AND IT IS THE ONE THAT MAKES THE MERGE WORK: `undefined`
 * in a PARTIAL means "this arm of the sweep did not answer this time", which
 * is not the same as "this arm answered and the answer is nothing". mergeCounts
 * keeps the previous value for an undefined arm and overwrites for a null one.
 * Three reads go out per sweep and they fail independently: a dead Warden must
 * not be able to blank the pile count.
 *
 * 🚨 AND THE MERGE IS FOR COUNTS ONLY — THE DOT DOES NOT READ IT. A held count
 * is the last figure anyone measured and it asserts nothing about now; a held
 * green dot asserts that the box is healthy, which is a claim about now and
 * the one claim nobody should be given by accident. So statusDot() is handed
 * THIS sweep's gate answer (gatesReading) and never the merged one, and the
 * two are allowed to disagree on screen: the Health tab can carry a badge of 2
 * red gates while the dot says "Not read", which is exactly the truth — two
 * was the last count, and this sweep could not get one.
 *
 * There are two callers, components/desk/desk-status.tsx and the Health board,
 * and lib/desk-status.spec.ts scans both for the wiring. A third caller would
 * have to be found by reading: the scan pins the files it names and cannot
 * know about one written later.
 *
 * ⚠️ PURE, AND IN lib/ FOR THE REASON EVERY RULE IN THIS REBUILD IS: vitest
 * collects `lib/**\/*.spec.ts` and `components/**\/*.spec.tsx` and NOTHING
 * under app/. A rule that must be checked cannot live in a page.
 */
import { fetchDeskFeed, type DeskFeed } from './desk-feed';
import { fetchWardenChat, type WardenChat } from './desk-site';
import { deskFetch } from './desk-auth';

/* ────────────────────────────────────────────────────────────────────────
 * The shape
 * ──────────────────────────────────────────────────────────────────────── */

export interface DeskStatusCounts {
  /** Cards on the pile — the Now tab's badge. */
  now: number | null;
  /** How many of those are late. Colours the Now badge; never its own badge. */
  overdue: number | null;
  /** Config gates reading `bad` — the Health tab's badge, and the dot. */
  redGates: number | null;
  /** Warden proposals still `pending` — the Agent tab's badge. */
  proposals: number | null;
}

/** Nothing has been read. Every badge silent, no dot drawn. */
export const NOTHING_READ: DeskStatusCounts = {
  now: null,
  overdue: null,
  redGates: null,
  proposals: null,
};

/* ────────────────────────────────────────────────────────────────────────
 * The derivations — one rule each, written once
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The pile, counted the way the pile counts itself.
 *
 * ⚠️ `cards.length`, NOT the sum of `bands`. app/admin/desk/page.tsx renders
 * `${visible.length} things need you` off the same array, so the badge and the
 * sub-line under it apply the SAME RULE to the SAME FIELD. A band total is a
 * different number the moment the server caps a band.
 *
 * 🚨 SAME RULE IS NOT SAME NUMBER, AND THIS COMMENT USED TO SAY THEY "AGREE BY
 * CONSTRUCTION" WITH ONE EXCEPTION. There are two, and the second is the one
 * an operator meets every day:
 *
 * 1. The undo window. The page filters out cards counting down under an undo
 *    and this does not, so for the ~6 seconds of an undo the badge can be one
 *    ahead of the header on the Now board itself.
 * 2. THE MOMENT. They are fed by two independent reads on two independent
 *    timers. app/admin/desk/page.tsx re-reads the feed after every drawer
 *    write (`onChanged={() => void load()}`) and on its own 60s tick; the
 *    shell's sweep has its own 60s tick and its own focus listener. So the
 *    instant an operator clears a card the header says 9 and the badge two
 *    inches above it still says 10, for up to a minute. Not after EVERY
 *    action — an action that leaves the pile the same length (a note on a
 *    member, say) re-reads to the same number and nothing diverges — but after
 *    every action that takes a card off, which is what the board is for.
 *
 * Closing (2) means the Now board calling DeskStatus.refresh() after each
 * write, and that lands in app/admin/desk/page.tsx — outside this module and
 * outside the track that wrote this. It is a real gap, not a tolerance: until
 * it is done the badge is the older of the two numbers on the phone header.
 */
export function pileCounts(feed: Pick<DeskFeed, 'cards' | 'pile'>): {
  now: number;
  overdue: number;
} {
  return { now: feed.cards.length, overdue: feed.pile.overdue };
}

/** The shape of /admin/desk/site/board this module actually reads. */
export interface StatusGates {
  gates: { tone: string }[];
}

/**
 * Red gates.
 *
 * ⚠️ ONE COPY OF THE PREDICATE, AND IT IS THIS ONE.
 * app/admin/desk/health/page.tsx used to repeat
 * `gates.filter(g => g.tone === 'bad').length` for its own sub-line and dot;
 * it imports this instead. They still read the endpoint separately and so can
 * differ about the MOMENT — that part is unavoidable and is why the dot is
 * handed one read at a time — but they can no longer differ about what counts
 * as red.
 */
export function redGateCount(board: StatusGates): number {
  return board.gates.filter((g) => g.tone === 'bad').length;
}

/**
 * Proposals waiting on the operator.
 *
 * 🚨 AN ABSENT DAEMON RETURNS null, NOT 0, AND THAT IS THE WHOLE POINT OF THIS
 * FUNCTION. `WardenChat.present: false` means the proposals array is empty
 * because nothing was READ — lib/desk-site.ts's own comment on `absence`
 * records the queue answering "nothing is waiting on you" about a list it
 * never saw. A tab badge is a smaller surface saying the same thing, so it
 * says nothing instead.
 */
export function pendingProposals(chat: Pick<WardenChat, 'present' | 'proposals'>): number | null {
  if (!chat.present) return null;
  return chat.proposals.filter((p) => p.status === 'pending').length;
}

/**
 * The header dot, from ONE read of the gates.
 *
 * 🚨 THE ARGUMENT IS A SINGLE READING, AND THAT IS THE FIX. It used to be
 * `(mergedRedGates, aSweepHasRunAtSomePoint)` — a count carried forward by
 * mergeCounts, and a flag that latched true on the first sweep and never went
 * back. So once ONE sweep had read the gates, every later gates failure was
 * invisible: the merge kept the old number, the flag stayed true, and the dot
 * printed "Healthy" from a measurement that could be hours old. A gates
 * endpoint returning 500 to every request for an afternoon left a green light
 * on every board for the afternoon. That is the same shape as the bug
 * DeskShellProps.site records, one layer in.
 *
 * ⚠️ THREE OUTCOMES, AND THEY ARE THE MODULE'S THREE STATES IN ONE VALUE:
 * `undefined` is nobody has asked yet and draws NO DOT; `null` is this read
 * asked and got nothing, and draws the `unknown` tone IN WORDS, because "we
 * could not find out" is worth an operator's attention and is invisible if it
 * renders the same as a healthy box; a number is a measurement and is the only
 * input that can produce green.
 *
 * Callers therefore have to hold a per-read value rather than the merged
 * count. components/desk/desk-status.tsx keeps one from gatesReading(); Health
 * passes its own board's count and passes `undefined` the moment its own read
 * fails, so a board that cannot see falls back to the sweep rather than
 * shouting "Not read" over a sweep that could.
 */
export function statusDot(
  gates: number | null | undefined,
): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; word: string } | undefined {
  if (gates === undefined) return undefined;
  if (gates === null) return { tone: 'unknown', word: 'Not read' };
  return gates > 0 ? { tone: 'bad', word: 'Attention' } : { tone: 'ok', word: 'Healthy' };
}

/**
 * Fold a sweep's answers over what was already on screen.
 *
 * ⚠️ AN ARM THAT DID NOT ANSWER IS ABSENT FROM `next`, AND ITS OLD VALUE
 * SURVIVES. That is the instruction this provider was built to: a poll that
 * errors leaves the tabs carrying their last known counts rather than dropping
 * to silence, because silence reads as an all-clear. `null` is different — it
 * is an arm that answered and told us it cannot know (an absent Warden), and
 * that DOES overwrite, or the badge would keep printing a figure from before
 * the daemon went away.
 *
 * ⚠️ COUNTS ONLY. The dot is NOT folded through here — see statusDot. The
 * difference is what the two things say: a badge reading 3 says "three was the
 * last figure read", which stays true however old it gets; a green dot says
 * "this box is healthy", which does not. The residual gap, stated rather than
 * hedged: an arm that has been failing for ten minutes leaves its badge
 * carrying that figure with nothing beside it saying so, and only the gates
 * arm has a second surface (the dot) that will admit it. Marking the other two
 * means threading StatusSweep.failed into components/desk/tabs.tsx.
 */
export function mergeCounts(
  prev: DeskStatusCounts,
  next: Partial<DeskStatusCounts>,
): DeskStatusCounts {
  const pick = <K extends keyof DeskStatusCounts>(k: K): number | null =>
    next[k] === undefined ? prev[k] : (next[k] as number | null);
  return {
    now: pick('now'),
    overdue: pick('overdue'),
    redGates: pick('redGates'),
    proposals: pick('proposals'),
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The sweep
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE ENDPOINT STRING IS WRITTEN TWICE AND THAT IS THE LESSER EVIL.
 * app/admin/desk/health/board.ts owns `fetchHealthBoard`, and lib/ importing
 * from app/ inverts the layering for every other module that would then be
 * allowed to do it. This reads the same route with the narrowest shape it
 * needs — the gate tones and nothing else — so the two cannot drift in a way
 * that matters: a board response this cannot parse is a board response Health
 * cannot parse either.
 */
export function fetchStatusGates(): Promise<StatusGates> {
  return deskFetch<StatusGates>('/admin/desk/site/board');
}

export interface StatusSweep {
  /** Only the arms that answered. An absent key means "ask again next time". */
  counts: Partial<DeskStatusCounts>;
  /** Which arms failed, by name. Empty on a clean sweep. */
  failed: string[];
}

/**
 * One sweep: three reads, three independent failures.
 *
 * ⚠️ allSettled, NEVER Promise.all. `all` rejects on the first failure and
 * throws away the two answers that arrived — so a Warden that is merely not
 * deployed would take the pile count and the gate count down with it, on every
 * board, for as long as it stayed down.
 */
export async function readDeskStatus(): Promise<StatusSweep> {
  const [feed, gates, chat] = await Promise.allSettled([
    fetchDeskFeed(),
    fetchStatusGates(),
    fetchWardenChat(),
  ]);

  const counts: Partial<DeskStatusCounts> = {};
  const failed: string[] = [];

  if (feed.status === 'fulfilled') Object.assign(counts, pileCounts(feed.value));
  else failed.push('pile');

  if (gates.status === 'fulfilled') counts.redGates = redGateCount(gates.value);
  else failed.push('gates');

  if (chat.status === 'fulfilled') counts.proposals = pendingProposals(chat.value);
  else failed.push('warden');

  return { counts, failed };
}

/**
 * What the GATES ARM of one sweep answered — the dot's input, and the reason
 * the dot cannot inherit a verdict from an earlier sweep.
 *
 * ⚠️ THIS IS THE ONE PLACE IN THIS MODULE WHERE "ABSENT" COLLAPSES INTO
 * `null`, AND IT IS NOT AN OVERSIGHT. Everywhere else the third state means
 * "keep what you had"; here there is nothing to keep, because the caller is
 * asking about this read and this read has either produced a number or it has
 * not. readDeskStatus writes `redGates` if and only if fetchStatusGates
 * resolved, so an absent key is a failed read.
 *
 * "Nobody has asked yet" is NOT expressible from a sweep — a sweep is an
 * asking — so it lives in the caller's initial state as `undefined`.
 */
export function gatesReading(sweep: StatusSweep): number | null {
  return sweep.counts.redGates === undefined ? null : sweep.counts.redGates;
}
