export function formatPrice(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// UX-7 — displayed discount percent for a compare-at ("was") price, or null
// when there's no valid discount to show. Capped at 70% (CPA s41 anti-
// anchoring; the backend also rejects compare-at > 4× price at write time).
// compareAt must exceed the sale price to render anything.
export function discountPercent(
  price: number | null | undefined,
  compareAt: number | null | undefined,
): number | null {
  if (!price || !compareAt || compareAt <= price) return null;
  const raw = Math.round(((compareAt - price) / compareAt) * 100);
  return Math.min(70, raw);
}

export const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
};

export const PROVINCE_LABELS: Record<string, string> = {
  EASTERN_CAPE: 'Eastern Cape',
  FREE_STATE: 'Free State',
  GAUTENG: 'Gauteng',
  KWAZULU_NATAL: 'KwaZulu-Natal',
  LIMPOPO: 'Limpopo',
  MPUMALANGA: 'Mpumalanga',
  NORTH_WEST: 'North West',
  NORTHERN_CAPE: 'Northern Cape',
  WESTERN_CAPE: 'Western Cape',
};

export const TIER_LABELS: Record<string, string> = {
  NEW: 'New Seller',
  ESTABLISHED: 'Established',
  TRUSTED: 'Trusted',
  TOP_SELLER: 'Top Seller',
  DEALER: 'Dealer',
};

export const LISTING_TYPE_LABELS: Record<string, string> = {
  BUY_NOW: 'Buy Now',
  TAKE_A_SHOT: 'Take a Shot',
  AUCTION: 'Auction',
  SWOP: 'Swop / Trade',
};

// Hunting Packages / Experiences (Phase E). Maps the ExperienceType enum
// to the user-facing package label shown on the sell form, listing detail,
// and order page.
export const EXPERIENCE_TYPE_LABELS: Record<string, string> = {
  RANGE_DAY: 'Range day',
  PLAINS_GAME_HUNT: 'Plains-game hunt',
};
