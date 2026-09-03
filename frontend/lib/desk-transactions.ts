import { deskFetch } from './desk-auth';

/**
 * THE DESK — the sales book.
 *
 * 🚨 THREE MODULES, ONE LETTER APART, AND THEY ARE THREE DIFFERENT UNITS OF
 * MONEY. desk-order (singular) is ONE sale's dossier. desk-orders (plural) is
 * the CART PARENT — an order with N lines. This one is the SALE as a row: the
 * Transaction, which is what a payout pays and what a refund refunds. Getting
 * them confused is the most expensive mistake available in this directory,
 * which is why each says so at the top.
 *
 * ⚠️ THIS EXISTS BECAUSE getTransactions PINNED paymentStatus ON EVERY CALL.
 * It defaulted to HELD and had no way to ask for anything else as a set, so
 * "the order book with the needs-attention filter" was recorded as unbuilt
 * when what was missing was one branch in a where-clause.
 */

export type SaleSegment =
  | 'HELD'
  | 'RELEASED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'PENDING'
  | 'ALL';

export const SALE_SEGMENTS: { value: SaleSegment; label: string }[] = [
  // ⚠️ HELD FIRST AND DEFAULT — it is the money-in-flight queue, and it is
  // what the server returns when no status is asked for. A board defaulting
  // to something else would paint a different list on first render than on a
  // refresh, with nothing on screen to explain it.
  { value: 'HELD', label: 'Held' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ALL', label: 'Everything' },
];

/**
 * The two deep-link filters the command centre and the health page already
 * send. Mirrored here so the sales book can honour a link that predates it.
 */
export type SaleFilter = 'accept-stalled' | 'dispatch-overdue';

export const SALE_FILTER_LABEL: Record<SaleFilter, string> = {
  'accept-stalled': 'Seller missed the 48h accept window',
  'dispatch-overdue': 'Paid over 24h ago, not dispatched',
};

export interface SaleRow {
  id: string;
  paymentStatus: string;
  /** ZAR cents, as the sale stored it. */
  buyerTotal: number | null;
  sellerPayout: number | null;
  createdAt: string;
  paidAt: string | null;
  releasedAt: string | null;
  payoutHeldAt: string | null;
  listing: { title: string; referenceNumber: string | null } | null;
  /** 🚨 USERNAME ONLY — the endpoint no longer returns names or emails. */
  buyer: { id: string; username: string | null } | null;
  seller: { id: string; username: string | null } | null;
}

export interface SalePage {
  rows: SaleRow[];
  total: number;
  page: number;
  limit: number;
}

export const SALES_PAGE_SIZE = 30;

/**
 * ⚠️ THE WIRE CALLS THE ARRAY `transactions`, NOT `rows`. Same trap as the
 * listings register, whose endpoint says `listings`, and the same failure if
 * mistyped: an empty book beside a correct-looking total, which reads as a
 * quiet week rather than a bug.
 */
interface SalePageWire {
  transactions?: SaleRow[];
  rows?: SaleRow[];
  total?: number;
  page?: number;
  limit?: number;
}

export async function fetchSalePage(
  segment: SaleSegment,
  page = 1,
  filter?: SaleFilter,
): Promise<SalePage> {
  const p = new URLSearchParams();
  p.set('status', segment);
  p.set('page', String(page));
  p.set('limit', String(SALES_PAGE_SIZE));
  if (filter) p.set('filter', filter);

  const res = await deskFetch<SalePageWire>(`/admin/transactions?${p.toString()}`);
  const rows = res?.transactions ?? res?.rows ?? [];
  return {
    rows,
    total: typeof res?.total === 'number' ? res.total : rows.length,
    page: res?.page ?? page,
    limit: res?.limit ?? SALES_PAGE_SIZE,
  };
}

/**
 * What a row's state actually means for the money, in one word.
 *
 * ⚠️ A PAYOUT HOLD IS NOT A PAYMENT STATUS, and the row has to say both. A
 * RELEASED sale with payoutHeldAt set is money the seller is owed and is not
 * getting this run — rendering only "released" would hide the hold, and
 * rendering only "held" would suggest the buyer's money never cleared.
 */
export function saleTone(row: SaleRow): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (row.payoutHeldAt) return 'warn';
  switch (row.paymentStatus) {
    case 'RELEASED':
      return 'ok';
    case 'DISPUTED':
      return 'bad';
    case 'REFUNDED':
      return 'neutral';
    case 'HELD':
      return 'info';
    default:
      return 'neutral';
  }
}

export function saleStateWords(row: SaleRow): string {
  const base = row.paymentStatus.replace(/_/g, ' ').toLowerCase();
  return row.payoutHeldAt ? `${base} · payout held` : base;
}
