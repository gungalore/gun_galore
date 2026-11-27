import type { SellerTier, TrustDashboard } from './types';

// ────────────────────────────────────────────────────────────────────
// THE TRUST-SCORE BARS, AS DATA.
//
// ⚠️ THE FOUR LOWER BARS USED TO BE INVENTED. Delivery success, dispatch speed,
// listing quality and account age were drawn as `trustScore * 0.2/0.15/0.10/
// 0.05` — fixed fractions of the total drawn at the right maxima, which looked
// like four separate measurements and were not. The backend serves the six real
// components (sales 25, rating 25, delivery 20, dispatch 15, quality 10, age 5);
// this module is the one mapping from that payload to the six bars, so the
// dashboard cannot quietly go back to percentages of the total.
// ────────────────────────────────────────────────────────────────────

/** The six bars, their maxima, and the order they render in. */
export const TRUST_BAR_SPECS = [
  { key: 'sales', label: 'Completed sales', max: 25 },
  { key: 'rating', label: 'Rating average', max: 25 },
  { key: 'delivery', label: 'Delivery success', max: 20 },
  { key: 'dispatch', label: 'Dispatch speed', max: 15 },
  { key: 'quality', label: 'Listing quality', max: 10 },
  { key: 'age', label: 'Account age', max: 5 },
] as const;

export type TrustBarKey = (typeof TRUST_BAR_SPECS)[number]['key'];

/** What the bar maths needs from the dashboard payload. */
export type TrustBarInput = Pick<
  TrustDashboard,
  'trustScore' | 'totalSales' | 'averageRating'
> &
  Partial<Pick<TrustDashboard, 'completedSales' | 'components'>>;

/**
 * The value behind each bar.
 *
 * ⚠️ THE OLD APPROXIMATION IS A FALLBACK ONLY, used when the backend has not
 * served `components` yet. It is deliberately not a per-field fallback for a
 * component the server sent as a real 0 — `?.` on the component object keeps
 * that distinction.
 */
export function trustBarValues(data: TrustBarInput): Record<TrustBarKey, number> {
  const components = data.components;
  return {
    sales:
      components?.sales ?? Math.min(25, data.completedSales ?? data.totalSales),
    rating:
      components?.rating ??
      (data.averageRating ? (data.averageRating / 5) * 25 : 0),
    delivery: components?.delivery ?? data.trustScore * 0.2,
    dispatch: components?.dispatch ?? data.trustScore * 0.15,
    quality: components?.quality ?? data.trustScore * 0.1,
    age: components?.age ?? data.trustScore * 0.05,
  };
}

/** Human labels for the tier pill — never `sellerTier.replace('_', ' ')`. */
export const SELLER_TIER_LABELS: Record<SellerTier, string> = {
  NEW: 'New seller',
  ESTABLISHED: 'Established',
  TRUSTED: 'Trusted',
  TOP_SELLER: 'Top Seller',
  // ⚠️ LEGACY MAPPING ONLY — no tier is awarded as Dealer any more, and no copy
  // may describe it. An old row carrying the value still renders a plain label.
  DEALER: 'Dealer',
};

export function sellerTierLabel(tier: SellerTier): string {
  return SELLER_TIER_LABELS[tier] ?? tier;
}

/**
 * How many ratings the average is over.
 *
 * ⚠️ THE WHOLE HISTORY, NOT THE RECENT SLICE. The dashboard lists a recent page;
 * the caption under the average must not say "from 5 ratings" for a seller with
 * eighty.
 */
export function averageRatingCount(
  data: Pick<TrustDashboard, 'recentRatings'> & Partial<Pick<TrustDashboard, 'totalRatings'>>,
): number {
  return data.totalRatings ?? data.recentRatings.length;
}
