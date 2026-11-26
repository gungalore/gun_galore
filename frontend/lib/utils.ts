export function formatPrice(cents: number): string {
  // Space after "R" matches the approved design boards (all 23 write "R 8,500"
  // not "R8,500") — display-only, nothing parses this string back into a number.
  //
  // ⚠️ WHOLE RANDS KEEP THE DESIGN'S "R 8,500"; CENTS ARE NOT ROUNDED AWAY.
  // The old 0-decimal formatter dropped the cents from every auction line, so a
  // hammer of R 8,500.50 printed "R 8,500" beside a bid stepper reading
  // "R 8,500.50" and the summary never footed (audit L7). Auctions and bids are
  // whole-rand in practice, so this changes nothing for the normal case — it
  // only stops a cent-bearing amount from lying.
  const wholeRands = cents % 100 === 0;
  return `R ${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: wholeRands ? 0 : 2,
    maximumFractionDigits: wholeRands ? 0 : 2,
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
  BUY_NOW: 'Marketplace',
  TAKE_A_SHOT: 'Take a Shot',
  AUCTION: 'Auction',
};
