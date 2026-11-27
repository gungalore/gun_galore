// ────────────────────────────────────────────────────────────────────
// THE SELLER STOREFRONT'S URLS, IN ONE PLACE.
//
// ⚠️ THE STOREFRONT HAS TWO PEOPLE IN IT AND THEY ARE NOT INTERCHANGEABLE.
// `sellerId` is whose shop this is (the route); the viewer's `userId` is whoever
// is looking. The page used to build its fetches and links from the viewer — so
// a signed-in person saw their own header and reviews under somebody else's URL,
// and a signed-out visitor requested `/sellers/undefined` and got a 404.
//
// Keeping the path construction here means there is ONE argument that can be
// wrong, and the specs pin that it is the seller's id.
// ────────────────────────────────────────────────────────────────────

/** The storefront's browse filters (the seller id is never one of them). */
export interface SellerStorefrontFilters {
  categoryId?: string;
  condition?: string;
  make?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  attrs?: string;
}

/** The API paths the storefront reads, both scoped to the SELLER. */
export function sellerApiPaths(sellerId: string): {
  profile: string;
  ratings: string;
} {
  const id = encodeURIComponent(sellerId);
  return {
    profile: `/sellers/${id}`,
    ratings: `/ratings/seller/${id}`,
  };
}

/** A page link on the seller's storefront, carrying the active filters. */
export function sellerPageHref(
  sellerId: string,
  filters: SellerStorefrontFilters,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value) next.set(key, value);
  }
  next.set('page', String(page));
  return `/sellers/${encodeURIComponent(sellerId)}?${next.toString()}`;
}
