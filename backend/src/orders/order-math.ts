// Phase 8b — pure order-math helpers (no Nest/Prisma deps, fully unit-
// tested). An Order is a buyer's cart paid in ONE capture; it fans out into
// N per-listing Transactions, each carrying its own Phase 1–7 fee breakdown.
// The Order's money snapshot is simply the SUM across those line breakdowns —
// no discounts or store-credit (that scope, 8c, is intentionally not built),
// so there is nothing to allocate; the buyer pays exactly the sum of the
// line buyerTotals.

import { BadRequestException } from '@nestjs/common';

/**
 * One cart line's money, taken verbatim from FeeCalculator.breakdown() for
 * that listing (so the per-line numbers are identical to a single-item
 * checkout of the same listing). All values are ZAR cents, integers.
 */
export interface OrderLineBreakdown {
  /** Unit price snapshot (ZAR cents) — listing.price at checkout. */
  unitPrice: number;
  quantity: number;
  /** Line subtotal = unitPrice × quantity (FeeCalculator's listingPrice). */
  listingPrice: number;
  shippingCost: number;
  /** P6.4 — the R15-per-waybill GG handling margin on this line (0 for
   *  firearm / collection / consolidated-sibling lines). */
  shippingHandlingCents: number;
  processingFee: number;
  /** What the buyer pays for this line (incl. shipping + handling + any passed fee). */
  buyerTotal: number;
}

/** The Order money snapshot persisted on the Order row (ZAR cents). */
export interface OrderTotals {
  itemsSubtotal: number;
  shippingSubtotal: number;
  /** P6.4 — sum of the line handling margins (GG-retained). */
  handlingSubtotal: number;
  processingFee: number;
  buyerTotal: number;
}

function assertInt(n: number, label: string): void {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequestException(`${label} must be a whole number of cents`);
  }
}

/**
 * Sum N line breakdowns into the Order's money snapshot. Throws on an empty
 * cart or non-integer cents (defensive — every upstream value is already in
 * integer cents). The buyer total is the plain sum of line buyer totals; the
 * Order must never charge more or less than the lines it contains.
 */
export function computeOrderTotals(lines: OrderLineBreakdown[]): OrderTotals {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BadRequestException('Cart is empty');
  }
  const totals: OrderTotals = {
    itemsSubtotal: 0,
    shippingSubtotal: 0,
    handlingSubtotal: 0,
    processingFee: 0,
    buyerTotal: 0,
  };
  for (const l of lines) {
    assertInt(l.listingPrice, 'line subtotal');
    assertInt(l.shippingCost, 'shipping');
    assertInt(l.shippingHandlingCents, 'shipping handling');
    assertInt(l.processingFee, 'processing fee');
    assertInt(l.buyerTotal, 'line total');
    totals.itemsSubtotal += l.listingPrice;
    totals.shippingSubtotal += l.shippingCost;
    totals.handlingSubtotal += l.shippingHandlingCents;
    totals.processingFee += l.processingFee;
    totals.buyerTotal += l.buyerTotal;
  }
  return totals;
}

/** Line subtotal for an OrderLineItem row (unitPrice × quantity). */
export function lineSubtotal(unitPrice: number, quantity: number): number {
  assertInt(unitPrice, 'unit price');
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('Quantity must be a whole number ≥ 1');
  }
  return unitPrice * quantity;
}

/**
 * Phase 8b is a SINGLE-SELLER cart: every line must belong to one seller.
 * (Multi-seller fan-out is Phase 8d.) Throws a clear error otherwise. Also
 * rejects an empty cart. Returns the single sellerId on success.
 */
export function assertSingleSeller(sellerIds: string[]): string {
  if (!Array.isArray(sellerIds) || sellerIds.length === 0) {
    throw new BadRequestException('Cart is empty');
  }
  const distinct = Array.from(new Set(sellerIds));
  if (distinct.length > 1) {
    throw new BadRequestException(
      'All items in one order must be from the same seller. Check out each seller separately.',
    );
  }
  return distinct[0];
}

/**
 * FLOW-F3 — roll a paid Order's status up from its children's payment
 * states. Order.status previously froze at PAID forever (COMPLETED /
 * REFUNDED / PARTIALLY_FULFILLED were never written). Pure function so the
 * live sync + the catch-all cron + tests all share one definition.
 *
 * Returns null while ANY child is still in flight (HELD / DISPUTED / etc.)
 * — the order stays PAID. Once every child is terminal:
 *   all RELEASED → COMPLETED · all REFUNDED → REFUNDED · mixed → PARTIALLY_FULFILLED.
 * Synthetic refund CHILD rows (refundOfId set) must be EXCLUDED by the
 * caller — they are payment plumbing, not order lines.
 */
export function computeOrderRollupStatus(
  childPaymentStatuses: string[],
): 'COMPLETED' | 'REFUNDED' | 'PARTIALLY_FULFILLED' | null {
  if (childPaymentStatuses.length === 0) return null;
  const terminal = (s: string) => s === 'RELEASED' || s === 'REFUNDED';
  if (!childPaymentStatuses.every(terminal)) return null;
  if (childPaymentStatuses.every((s) => s === 'RELEASED')) return 'COMPLETED';
  if (childPaymentStatuses.every((s) => s === 'REFUNDED')) return 'REFUNDED';
  return 'PARTIALLY_FULFILLED';
}

/**
 * A cart cannot contain the same listing twice (the buyer should raise the
 * quantity instead — and firearms/auctions are single-item anyway). Throws on
 * a duplicate listingId.
 */
export function assertNoDuplicateListings(listingIds: string[]): void {
  const distinct = new Set(listingIds);
  if (distinct.size !== listingIds.length) {
    throw new BadRequestException(
      'This item is already in your cart — adjust the quantity instead of adding it again.',
    );
  }
}
