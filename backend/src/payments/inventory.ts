// Pure inventory state-machine helpers (Phase 8a).
//
// Legacy single-item listings (trackInventory = false) NEVER use these —
// they keep the existing ACTIVE→PAYMENT_PENDING→SOLD status flips, bit-for-
// bit unchanged. These helpers only drive the counter-based path for
// inventory-tracked listings, and they are pure so the stock arithmetic is
// unit-testable without the Nest container or a DB.
//
// Invariants for a tracked listing:
//   sellable        = quantityAvailable − quantityReserved
//   reserve(q)      requires sellable ≥ q          → quantityReserved += q
//   confirmSale(q)  → quantityAvailable −= q, quantityReserved −= q; SOLD at 0
//   releaseSold(q)  (refund/cancel/reject AFTER pay) → quantityAvailable += q, ACTIVE
//   releaseReserve(q) (gateway failed BEFORE pay)    → quantityReserved −= q

export type ListingTypeLike = 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';

// A listing may only be inventory-tracked (qty > 1) if it is a plain
// BUY_NOW, non-firearm listing. Firearms are 1-serial-per-SAPS-534;
// auctions + take-a-shot + swop are inherently single-item.
export function inventoryEligible(
  listingType: ListingTypeLike,
  isFirearm: boolean,
): boolean {
  return listingType === 'BUY_NOW' && !isFirearm;
}

// Validate a requested purchase quantity against a listing's state.
// Returns the effective quantity to use, or an error string the caller
// turns into a BadRequestException. Single-item (non-tracked) listings
// always resolve to quantity 1.
export function resolvePurchaseQuantity(opts: {
  requested?: number | null;
  trackInventory: boolean;
  quantityAvailable: number;
  quantityReserved: number;
}): { quantity: number } | { error: string } {
  const { trackInventory, quantityAvailable, quantityReserved } = opts;
  if (!trackInventory) return { quantity: 1 };

  const q = Math.floor(Number(opts.requested ?? 1));
  if (!Number.isFinite(q) || q < 1) {
    return { error: 'Quantity must be a whole number of 1 or more.' };
  }
  const sellable = quantityAvailable - quantityReserved;
  if (q > sellable) {
    return {
      error:
        sellable <= 0
          ? 'This item is sold out.'
          : `Only ${sellable} left — reduce the quantity.`,
    };
  }
  return { quantity: q };
}

// The Prisma `data` fragment to restock a tracked listing when a CONFIRMED
// (paid) sale is reversed — admin refund, buyer cancel, seller reject,
// auto-refund. Legacy listings pass through the plain reactivation the
// callers already do (this returns just status/soldAt for them).
//
// P0.2 (review fix) — an ENDED AUCTION must never be resurrected to
// ACTIVE: finalizeAuction has already run (endedAt set) so it can never
// re-finalize, bidding is closed (endTime past), and the winner-checkout
// branch requires PAYMENT_PENDING — an ACTIVE ended auction is a
// permanently unbuyable zombie on browse. Reversals of a paid auction
// sale land the listing in EXPIRED instead (terminal; seller relists).
// Callers pass the listing's type so this stays the single chokepoint.
export function reversalListingData(
  trackInventory: boolean,
  quantity: number,
  listingType?: ListingTypeLike | string | null,
): { status: 'ACTIVE' | 'EXPIRED'; soldAt: null; quantityAvailable?: { increment: number } } {
  if (listingType === 'AUCTION') return { status: 'EXPIRED', soldAt: null };
  if (!trackInventory) return { status: 'ACTIVE', soldAt: null };
  return {
    status: 'ACTIVE',
    soldAt: null,
    quantityAvailable: { increment: Math.max(1, Math.floor(quantity)) },
  };
}

// Given a tracked listing's state at confirm time, decide whether this sale
// exhausts stock (→ flip to SOLD). Caller does the atomic decrement.
export function isSoldOutAfterSale(opts: {
  quantityAvailable: number;
  quantity: number;
}): boolean {
  return opts.quantityAvailable - opts.quantity <= 0;
}
