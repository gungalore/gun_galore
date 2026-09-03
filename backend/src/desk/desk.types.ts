/**
 * THE DESK — the feed contract, server side.
 *
 * Mirrors frontend/lib/desk-feed.ts exactly. Kept as its own file so the two
 * can be diffed by eye when either moves; there is no shared package between
 * the apps, so this is the only honest way to keep them in step.
 */

export const BAND_ORDER = ['money_firearms', 'disputes', 'reviews_cases', 'housekeeping'] as const;
export type BandKey = (typeof BAND_ORDER)[number];

export type DeskCardType =
  | 'firearm_transfer'
  | 'payout_run'
  | 'dispute'
  | 'listing_review'
  | 'seller_verification'
  | 'dispatch_check'
  | 'complaint'
  | 'support'
  | 'whatsapp_reply'
  | 'stale_listing'
  | 'unanswered_question'
  | 'warden';

export type TagKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'ink';
export type ActionKind = 'undo' | 'money' | 'drawer' | 'link' | 'gated';

export interface FeedTag {
  kind: TagKind;
  label: string;
  icon?: 'clock' | 'alert' | 'lock' | 'check' | 'info' | 'bolt';
}

export interface FeedAction {
  key: string;
  label: string;
  kind: ActionKind;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gated';
  href?: string;
  amount?: string;
  doneMessage?: string;
}

export interface DeskCardData {
  id: string;
  type: DeskCardType;
  typeLabel: string;
  /**
   * Overrides the per-type header glyph.
   *
   * ⚠️ TWO WARDEN FACES SHARE ONE TYPE. A red gate and a proposal are both
   * 'warden', so without this the pile draws a bolt on both where the
   * catalogue draws a padlock on the gate. Mirrors lib/desk-feed.ts.
   */
  icon?: FeedTag["icon"];
  band: BandKey;
  reference?: string;
  headline: string;
  meta?: string;
  note?: string;
  tags: FeedTag[];
  actions: FeedAction[];
  overdueSince?: string;
  canLater: boolean;
  laterUntil?: string;
}

export interface RibbonCellData {
  label: string;
  value: string;
  sub?: string;
  dot?: 'ok' | 'warn' | 'bad' | 'info' | 'unknown';
}

export interface ActivityEntry {
  time: string;
  text: string;
  reference?: string;
}

export interface DeskFeed {
  cards: DeskCardData[];
  bands: { key: BandKey; count: number }[];
  ribbon: RibbonCellData[];
  money: {
    held: string;
    payable: string;
    blocked: string;
    /** The raw figure behind `blocked`, so the rail can colour the row by its
     *  VALUE. The tone was hard-coded to amber, so R0 blocked — the good
     *  state, and the usual one — read as a warning on every load. */
    blockedCents?: number;
    refundPending: string;
    heldSub?: string;
    payableSub?: string;
    blockedSub?: string;
    refundSub?: string;
    gateNote?: string;
  };
  pile: { overdue: number; sunk: number; sunkReturnsAt?: string };
  activity: ActivityEntry[];
}

/**
 * ⚠️ THE ONLY SLA CONSTANTS THAT EXIST IN THIS CODEBASE.
 *
 * Every one of these is lifted from a place that already enforces it, not
 * invented for the UI. A card that says "19h over SLA" when nothing in the
 * system acts at 19h is a lie the operator will plan around.
 *
 * Two card types deliberately have NO overdue notion, because the code has no
 * deadline for them:
 *
 *   LISTING REVIEW — nothing ages a PENDING_REVIEW listing. The queue is
 *   FIFO (createdAt asc) and that is all. The card shows its position in the
 *   queue ("oldest of 6") rather than a fabricated clock.
 *
 *   DISPUTE — no cron, constant or sweep ages a DISPUTED transaction; the
 *   only urgency marker is a static `urgent: true` on the alert raised when
 *   it opens. The design canvas shows "due in 14h · 48h SLA"; there is no
 *   48-hour dispute SLA in this system. Rather than invent one, the card
 *   shows when the dispute was opened and lets the operator judge.
 */
export const SLA = {
  /**
   * Dealer verification awaiting admin review.
   * Source: TasksService.dealerVerificationAgeingSweep — reviewCutoff is
   * now − 48h against dealerVerificationStatus PENDING_ADMIN_REVIEW.
   */
  DEALER_REVIEW_HOURS: 48,

  /**
   * Paid but not dispatched.
   * Source: AdminCommandCenterService.attentionQueue — dispatchCutoff is
   * now − 24h against paymentStatus HELD + paidAt set + dispatchedAt null.
   * This is the "at risk" heuristic, not the hard deadline below.
   */
  DISPATCH_AT_RISK_HOURS: 24,

  /**
   * KYC that has sat unverified.
   * Source: the 24h cutoff duplicated in AdminService.getUsers and
   * AdminCommandCenterService.attentionQueue, measured from kycRequiredAt.
   */
  KYC_STALLED_HOURS: 24,

  /** How long a card sinks for when the operator taps Later. */
  LATER_HOURS: 4,
} as const;
