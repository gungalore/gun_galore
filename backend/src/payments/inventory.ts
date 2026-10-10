// Pure inventory state-machine helpers (Phase 8a).
//
// Legacy single-item listings (trackInventory = false) NEVER use these —
// they keep the existing ACTIVE→PAYMENT_PENDING→SOLD status flips, bit-for-
// bit unchanged. These helpers only drive the counter-based path for
// inventory-tracked listings, and they are pure so the stock arithmetic is
// unit-testable without the Nest container or a DB.
//
// Invariants for a tracked listing (MODEL A — the model the service actually
// writes): `quantityAvailable` ALREADY excludes in-flight reservations, so
// sellable == quantityAvailable. The reserve is a single-column compare-and-set
// (`quantityAvailable >= q` → decrement), which is only sound under Model A;
// subtracting quantityReserved again would double-count and under-sell. This is
// the model the service implements — see the reserve CAS + markPaid in
// transactions.service.ts.
//   sellable        = quantityAvailable
//   reserve(q)      requires quantityAvailable ≥ q → quantityAvailable −= q,
//                                                        quantityReserved += q
//   confirmSale(q)  → quantityReserved −= q (available already decreased); SOLD at 0
//   releaseSold(q)  (refund/cancel/reject AFTER pay) → quantityAvailable += q, ACTIVE
//   releaseReserve(q) (gateway failed BEFORE pay)    → quantityAvailable += q,
//                                                        quantityReserved −= q

export type ListingTypeLike = 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';

// A listing may only be inventory-tracked (qty > 1) if it is a plain
// BUY_NOW, non-firearm, non-experience listing. Firearms are
// 1-serial-per-SAPS-534; auctions + take-a-shot + swop are inherently
// single-item; a hunting-package experience is a single on-site booking
// (capacity is metadata, not sellable stock).
export function inventoryEligible(
  listingType: ListingTypeLike,
  isFirearm: boolean,
  isExperience = false,
): boolean {
  return listingType === 'BUY_NOW' && !isFirearm && !isExperience;
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
  const { trackInventory, quantityAvailable } = opts;
  if (!trackInventory) return { quantity: 1 };

  const q = Math.floor(Number(opts.requested ?? 1));
  if (!Number.isFinite(q) || q < 1) {
    return { error: 'Quantity must be a whole number of 1 or more.' };
  }
  // Model A: quantityAvailable already nets out in-flight reservations, so it
  // IS the sellable count (see the file header). quantityReserved is accepted
  // for interface compatibility but must NOT be subtracted again.
  const sellable = quantityAvailable;
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
