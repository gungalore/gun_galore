// ────────────────────────────────────────────────────────────────────
// "MORE LISTINGS FROM THIS SELLER" — THE VISIBILITY RULE.
//
// ⚠️ EXCLUDES THE LISTING BEING VIEWED, CAPS AT FOUR, AND SELF-HIDES. A seller
// with nothing else active gets no section at all; a seller with twelve listings
// gets the four that fit one row. The page fetches the candidates; this decides
// what is worth drawing.
// ────────────────────────────────────────────────────────────────────

export const MORE_FROM_SELLER_LIMIT = 4;

/**
 * The cards to show under "More listings from this seller".
 *
 * ⚠️ `id` IS REQUIRED ON THE CANDIDATES; it is the exclusion key. Callers that
 * cannot supply it should pass an empty list rather than rendering duplicates of
 * the current listing.
 */
export function moreFromSeller<T extends { id: string }>(
  listings: T[] | null | undefined,
  currentListingId: string,
  limit = MORE_FROM_SELLER_LIMIT,
): T[] {
  if (!listings?.length) return [];
  return listings
    .filter((listing) => listing && listing.id !== currentListingId)
    .slice(0, Math.max(0, limit));
}

/** Whether the section renders at all. */
export function showsMoreFromSeller<T extends { id: string }>(
  listings: T[] | null | undefined,
  currentListingId: string,
): boolean {
  return moreFromSeller(listings, currentListingId).length > 0;
}
