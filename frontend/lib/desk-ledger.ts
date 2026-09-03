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
