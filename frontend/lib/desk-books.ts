import { deskFetch } from './desk-auth';

/**
 * THE DESK — Books: the client-money position and the failed-sync radar.
 *
 * Two endpoints on the manual-payments controller that survived the manual-EFT
 * rail removal and were never called by anything. Both are back-office money
 * questions rather than per-order work, which is why they share a lens.
 */

/* ── Held funds: what of the bank balance is not ours ─────────────────── */

export interface FundsBucket {
  count: number;
  cents: number;
}

export interface HeldFunds {
  asOf: string;
  /** 'manual' | 'paygate' | … — see the refunds bucket below. */
  paymentMode: string;
  heldAwaitingRelease: FundsBucket;
  owedToSellers: FundsBucket;
  owedToBuyerRefunds: FundsBucket;
  swapCashHeld: FundsBucket;
  swapFundingInFlight: FundsBucket;
  totalClientFundsCents: number;
}

export function fetchHeldFunds(): Promise<HeldFunds> {
  return deskFetch('/admin/manual-payments/held-funds');
}

/**
 * Does the buyer-refunds bucket mean anything in this payment mode?
 *
 * 🚨 IT IS STRUCTURALLY EMPTY UNLESS PAYMENT_MODE IS 'manual'. The service
 * skips the query entirely otherwise, because a card gateway reverses on the
 * card and nothing is owed out of our account. So a zero here is NOT "no
 * refunds are owed" — it is "this question does not apply", and rendering
 * R0.00 would be a measured-looking figure that was never measured. Same rule
 * as the Desk's unknown-is-an-em-dash-never-a-zero elsewhere.
 */
export function refundsBucketApplies(paymentMode: string): boolean {
  return paymentMode === 'manual';
}

/** The five buckets, in the order an accountant reads them. */
export function fundsBuckets(
  f: HeldFunds,
): { key: string; label: string; bucket: FundsBucket; note?: string }[] {
  return [
    {
      key: 'held',
      label: 'Held from buyers',
      bucket: f.heldAwaitingRelease,
      note: 'Paid and captured, not yet released to the seller.',
    },
    {
      key: 'sellers',
      label: 'Owed to sellers',
      bucket: f.owedToSellers,
      note: 'Released and not yet settled — this is what a payout run pays.',
    },
    {
      key: 'refunds',
      label: 'Owed to buyers',
      bucket: f.owedToBuyerRefunds,
      note: refundsBucketApplies(f.paymentMode)
        ? 'Refunded and not yet paid out.'
        : `Not applicable in ${f.paymentMode} mode — a card gateway reverses on the card, so nothing is owed out of the account.`,
    },
    { key: 'swapCash', label: 'Swap cash held', bucket: f.swapCashHeld },
    {
      key: 'swapFunding',
      label: 'Swap funding in flight',
      bucket: f.swapFundingInFlight,
      note: 'One side has paid and the swap has not locked — reimbursed if the other lapses.',
    },
  ];
}

/* ── The failed-sync radar ────────────────────────────────────────────── */

export interface ZohoFailedTransaction {
  id: string;
  orderReference: string | null;
  zohoSyncError: string | null;
  zohoSyncLastAttemptAt: string | null;
}

export interface ZohoFailedCharge {
  id: string;
  orderReference: string | null;
  errorMessage: string | null;
  chargedAt: string | null;
}

export interface ZohoFailedSwap {
  id: string;
  initiatorFundingRef: string | null;
  swapFeeInitiator: number;
  zohoInitiatorFeeReceiptId: string | null;
  swapFeeOwner: number;
  zohoOwnerFeeReceiptId: string | null;
  completedAt: string | null;
}

export interface ZohoFailed {
  transactions: ZohoFailedTransaction[];
  subscriptionCharges: ZohoFailedCharge[];
  swaps: ZohoFailedSwap[];
  totalFailed: number;
}

export function fetchZohoFailed(): Promise<ZohoFailed> {
  return deskFetch('/admin/manual-payments/zoho-failed');
}

/**
 * Each arm is capped at 50 rows server-side.
 *
 * 🚨 SO `totalFailed` IS A FLOOR, NOT A TOTAL. It is the sum of three arrays
 * that were each `take: 50`, which means 50 failed transactions and 50 more
 * waiting both report "50". A board printing that number flat says something
 * measured about a set it never counted — the same class of lie as a page
 * footer printing a total over a truncated list.
 */
export const ZOHO_ARM_CAP = 50;

export function radarIsCapped(z: ZohoFailed): boolean {
  return (
    z.transactions.length >= ZOHO_ARM_CAP ||
    z.subscriptionCharges.length >= ZOHO_ARM_CAP ||
    z.swaps.length >= ZOHO_ARM_CAP
  );
}

export function describeRadarTotal(z: ZohoFailed): string {
  if (z.totalFailed === 0) return 'Nothing has failed to reach Books.';
  const n = `${z.totalFailed} ${z.totalFailed === 1 ? 'record' : 'records'}`;
  return radarIsCapped(z)
    ? `At least ${n} — one of these lists is at its 50-row cap, so the real number is higher.`
    : `${n} have not reached Books.`;
}

/**
 * 🚨 THE THREE ARMS ARE NOT THE SAME KIND OF THING, AND ONLY ONE IS A RADAR.
 *
 * Established by reading the writers, not the comments:
 *
 *  · TRANSACTIONS is real. zoho-books.service.ts actively writes
 *    zohoSyncStatus as OK / PENDING / FAILED / SKIPPED, so a row here is a
 *    genuine, recent failure — and it is the one arm with a repair, because
 *    POST /admin/transactions/:id/zoho-retry is idempotent and wired into the
 *    Order drawer.
 *
 *  · SUBSCRIPTION CHARGES keys on `zohoReceiptId IS NULL`, and NOTHING IN THE
 *    BACKEND EVER WRITES zohoReceiptId. A row here cannot clear itself by any
 *    code path that exists; it needs the receipt raised in Zoho by hand.
 *
 *  · SWAPS keys on zohoInitiatorFeeReceiptId / zohoOwnerFeeReceiptId, and
 *    nothing writes those either. ⚠️ THE SERVICE COMMENT SAYS THESE ARE
 *    "re-fired by the hourly retryMissingSwapFeeReceipts cron" — THAT CRON
 *    DOES NOT EXIST. Grep finds the name in that one comment and nowhere else.
 *    So a swap appearing here is permanent until someone writes code, and the
 *    comment would have an operator wait for a repair that never runs.
 *
 * Presenting three arms identically would send an operator chasing two lists
 * that cannot be worked and waiting on a cron that was never built.
 */
export type ArmKind = 'actionable' | 'manual-only' | 'stuck';

export interface ArmMeta {
  kind: ArmKind;
  /** What an operator can actually do about a row in this arm. */
  guidance: string;
}

export const ZOHO_ARMS: Record<'transactions' | 'subscriptionCharges' | 'swaps', ArmMeta> = {
  transactions: {
    kind: 'actionable',
    guidance:
      'Open the sale and press Retry the Books post — the endpoint is idempotent, so it is safe on a row that has since succeeded.',
  },
  subscriptionCharges: {
    kind: 'manual-only',
    guidance:
      'No retry exists for a subscription receipt, and nothing in the backend writes zohoReceiptId — raise the receipt in Zoho Books directly.',
  },
  swaps: {
    kind: 'stuck',
    guidance:
      'Nothing writes the swap fee receipt ids and the retryMissingSwapFeeReceipts cron the service comment names does not exist — a row here will not clear on its own.',
  },
};

/** The fee legs on a swap row that are actually missing a receipt. */
export function missingSwapLegs(s: ZohoFailedSwap): string[] {
  const legs: string[] = [];
  if (s.swapFeeInitiator > 0 && !s.zohoInitiatorFeeReceiptId) legs.push('initiator');
  if (s.swapFeeOwner > 0 && !s.zohoOwnerFeeReceiptId) legs.push('owner');
  return legs;
}
