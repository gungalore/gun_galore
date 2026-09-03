/**
 * THE DESK — the Ledger and the payout run.
 *
 * ⚠️ THE UNIT OF A PAYOUT IS ONE SALE. Never a seller, never the run. The
 * money strip counts sales, the run drawer lists sales, and every control
 * that moves money names the one sale it moves. A seller with three released
 * sales is three rows the operator can pay or hold independently — which is
 * only expressible if the sale is the unit all the way up.
 */
import { deskFetch } from './desk-auth';

export interface PayoutRow {
  id: string;
  reference: string;
  item: string;
  seller: string | null;
  /** Net of refund slices and any wasted-courier charge — what actually goes. */
  amountCents: number;
  bankVerified?: boolean;
  blockedReason?: string | null;
}

export interface HeldPayoutRow extends PayoutRow {
  heldAt: string | null;
  reason: string | null;
}

export interface PayoutRun {
  /** PAYMENTS_LIVE is off: every money control renders gated and declines. */
  gated: boolean;
  inRun: PayoutRow[];
  held: HeldPayoutRow[];
  blocked: PayoutRow[];
  totals: {
    inRunCents: number;
    inRunLabel: string;
    heldCents: number;
    heldLabel: string;
    blockedCents: number;
    blockedLabel: string;
    sellerCount: number;
    saleCount: number;
  };
}

export function fetchPayoutRun(): Promise<PayoutRun> {
  return deskFetch<PayoutRun>('/admin/desk/payouts/run');
}

/**
 * Hold one sale out of every run until it is included again.
 *
 * ⚠️ NOT MONEY, SO IT WORKS WHILE THE GATE IS OFF. Holding is the one payout
 * lever that changes no balance — it only decides whether a row is offered to
 * the next run. That is exactly why it is available now, with payments gated:
 * the operator can curate tomorrow's run today.
 */
export function holdPayout(transactionId: string, reason: string): Promise<unknown> {
  return deskFetch(`/admin/transactions/${encodeURIComponent(transactionId)}/hold-payout`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** Put a held sale back into the run. */
export function includePayout(transactionId: string, reason: string): Promise<unknown> {
  return deskFetch(
    `/admin/transactions/${encodeURIComponent(transactionId)}/release-payout-hold`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export function formatRandCents(cents: number): string {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
}

/* ── The disbursement itself ──────────────────────────────────────────── */

/**
 * Pay every due seller, in one batch.
 *
 * 🚨 THIS IS THE ONE CALL THE DESK NEVER MADE. The run preview, the segments,
 * the hold and lift levers and the confirm dialog were all built and correct;
 * the confirm's own handler reported "not wired from the Desk yet" and pointed
 * at a handover note. So the Ledger could show an operator exactly what was
 * owed, to whom, and why a row was held back — and could not pay any of it.
 *
 * ⚠️ IT IS GATED ON PAYMENTS_LIVE INSIDE THE SERVICE, and throws rather than
 * returning a shape when the switch is off. That is why the board renders the
 * gated variant instead of calling and reporting the error: a control that
 * fires and then explains why it could not is worse than one that says so
 * first, on a surface about money.
 *
 * ⚠️ EXACTLY-ONCE IS THE SERVER'S, VIA paidOutAt — not this call's. Pressing
 * twice does not pay twice, but it does start a second Peach batch, so the
 * button is disabled while the first is in flight.
 */
export interface PayoutRunResult {
  attempted: number;
  accepted: number;
  failed: number;
  totalCents: number;
  skipped: { id: string; reason: string }[];
}

export function runDuePayouts(): Promise<PayoutRunResult> {
  return deskFetch('/admin/manual-payments/run-payouts', { method: 'POST' });
}

/**
 * What the operator is told afterwards.
 *
 * ⚠️ ACCEPTED IS NOT PAID. Peach accepts a batch and settles it asynchronously;
 * the payout webhook reconciles. Reporting "12 sellers paid" at this point
 * would be a claim the platform cannot yet make — and the one an operator
 * would repeat to a seller.
 */
export function describePayoutRun(r: PayoutRunResult): string {
  if (r.attempted === 0) return 'Nothing was due — no payout was sent.';
  const money = formatRandCents(r.totalCents);
  const head = `${r.accepted} of ${r.attempted} accepted by the bank rail (${money}).`;
  const failed = r.failed > 0 ? ` ${r.failed} were refused and stay due.` : '';
  const skipped = r.skipped.length > 0 ? ` ${r.skipped.length} skipped.` : '';
  return `${head}${failed}${skipped} Accepted is not settled — the payout webhook confirms each one.`;
}
