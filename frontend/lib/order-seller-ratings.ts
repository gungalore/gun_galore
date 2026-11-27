// ────────────────────────────────────────────────────────────────────
// WHO CAN RATE WHOM ON AN ORDER.
//
// ⚠️ ONE RATING PER SELLER PER ORDER. A cart can hold items from several
// sellers; the order endpoint now serves one entry per seller with the single
// transaction that rating hangs off, and the order page is the only place that
// rating is made. The transaction page links here instead of offering a second,
// per-line rating the backend rejects.
//
// This module is the decision the order page renders from: what each seller's
// row is (a widget, a saved summary, a waiting line), and whether the section
// appears at all. Kept pure so the three states are unit-tested without an
// authenticated page render.
// ────────────────────────────────────────────────────────────────────

/** One seller's rating on an order. Mirrors the backend's sellers[] entry. */
export interface OrderSellerRating {
  id: string;
  stars: number;
  comment: string | null;
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  createdAt: string;
  transactionId: string;
}

export interface OrderSellerEntry {
  sellerId: string;
  username: string | null;
  transactionId: string | null;
  canRate: boolean;
  rating: OrderSellerRating | null;
}

/**
 * What to draw for one seller:
 * - `rate`: the buyer can rate now, against that seller's transaction;
 * - `saved`: a rating already exists — read-only summary;
 * - `waiting`: nothing to rate yet — the "once every item is delivered" line;
 * - `hidden`: no transaction and no rating — nothing to act on.
 */
export type OrderSellerRowMode = 'rate' | 'saved' | 'waiting' | 'hidden';

export function orderSellerRowMode(
  seller: OrderSellerEntry,
): OrderSellerRowMode {
  if (seller.rating) return 'saved';
  if (!seller.transactionId) return 'hidden';
  return seller.canRate ? 'rate' : 'waiting';
}

/** The sellers worth a row, in the server's order. */
export function visibleOrderSellers(
  sellers: OrderSellerEntry[] | null | undefined,
): OrderSellerEntry[] {
  return (sellers ?? []).filter(
    (seller) => orderSellerRowMode(seller) !== 'hidden',
  );
}

/**
 * Whether the "Rate your sellers" section appears at all.
 *
 * ⚠️ ONLY WHEN THERE IS SOMETHING TO DO OR SHOW. An order of sellers who are all
 * still mid-delivery would otherwise grow a section of three "you can rate this
 * seller later" lines — that belongs on the transaction, not here.
 */
export function showsSellerRatingSection(
  sellers: OrderSellerEntry[] | null | undefined,
): boolean {
  return (sellers ?? []).some((seller) => seller.canRate || seller.rating);
}

/** The line items this seller sold, where the order entry names their transaction. */
export function orderItemsForSeller<
  T extends { transaction: { id: string } | null },
>(lineItems: T[], seller: OrderSellerEntry): T[] {
  if (!seller.transactionId) return [];
  return lineItems.filter(
    (line) => line.transaction?.id === seller.transactionId,
  );
}
