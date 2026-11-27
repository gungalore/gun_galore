import type { DeliveryClass, DeliveryMethodOption } from './delivery-methods';

// ────────────────────────────────────────────────────────────────────
// SMALL PURE DECISIONS AROUND THE CATALOG UI.
//
// The listing page, the cards and the delivery toggle all need a couple of
// "should this render / is this purchasable" answers. They live here so a spec
// can pin them without an authenticated page render (app/** is outside the
// vitest include).
// ────────────────────────────────────────────────────────────────────

interface ListingShape {
  id?: string;
  listingType?: string;
  status?: string;
  isFirearm?: boolean;
  collectionOnly?: boolean;
  shippingMethods?: string[] | null;
}

/** Only an ACTIVE BUY_NOW listing can be bought, carted or quickly bought. */
export function isPurchasableBuyNow(listing: ListingShape): boolean {
  return listing.listingType === 'BUY_NOW' && listing.status === 'ACTIVE';
}

/**
 * The mobile sticky bar is a BUY bar: it may only appear for an ACTIVE BUY_NOW
 * listing (not sold out). The owner's Edit affordance is the one exception —
 * it is not a purchase.
 *
 * ⚠️ AN AUCTION NEVER GETS THE BUY BAR. Auctions stay single-item: the
 * AuctionPanel owns bidding and there is no cart trace of any kind.
 */
export function showsStickyBuyBar(
  listing: ListingShape,
  opts: { soldOut: boolean; isOwnListing: boolean },
): boolean {
  if (listing.status !== 'ACTIVE' || opts.soldOut) return false;
  return opts.isOwnListing || listing.listingType === 'BUY_NOW';
}

/**
 * Add-to-cart exists only for ACTIVE BUY_NOW. Collection-only/Private lines ARE
 * valid cart lines now (the cart groups them and handles the papers
 * acknowledgement); auctions and offers never enter the cart.
 */
export function canAddToCart(listing: ListingShape): boolean {
  return isPurchasableBuyNow(listing);
}

/**
 * The delivery pair a listing legitimately shows, as delivery-methods options.
 * Kept here as a thin re-export so pages do not each import two modules.
 */
export function listingDeliveryClass(
  listing: ListingShape,
): DeliveryClass {
  return listing.isFirearm ? 'FIREARM' : 'GOODS';
}

export type { DeliveryMethodOption };
