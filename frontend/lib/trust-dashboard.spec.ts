import { describe, expect, it } from 'vitest';
import {
  SELLER_TIER_LABELS,
  TRUST_BAR_SPECS,
  averageRatingCount,
  sellerTierLabel,
  trustBarValues,
} from './trust-dashboard';

// ⚠️ THE BUG THIS PINS: four dashboard bars were `trustScore * 0.2/0.15/0.10/
// 0.05` — invented numbers at the right maxima. A high-scoring seller saw a
// perfect delivery/dispatch/quality/age bar regardless of the underlying record.
describe('the trust-score bars', () => {
  it('uses the six real components and their real maxima, in order', () => {
    const bars = trustBarValues({
      trustScore: 80,
      totalSales: 10,
      averageRating: 4.5,
      components: {
        sales: 10,
        rating: 22,
        delivery: 20,
        // A REAL ZERO must stay zero — it is a measurement, not a missing value.
        dispatch: 0,
        quality: 7,
        age: 5,
      },
    });
    expect(bars).toEqual({
      sales: 10,
      rating: 22,
      delivery: 20,
      dispatch: 0,
      quality: 7,
      age: 5,
    });
    expect(TRUST_BAR_SPECS.map((spec) => spec.max)).toEqual([
      25, 25, 20, 15, 10, 5,
    ]);
    expect(TRUST_BAR_SPECS.map((spec) => spec.label)).toEqual([
      'Completed sales',
      'Rating average',
      'Delivery success',
      'Dispatch speed',
      'Listing quality',
      'Account age',
    ]);
  });

  it('falls back to the old approximation only when components are missing', () => {
    const bars = trustBarValues({
      trustScore: 80,
      totalSales: 10,
      averageRating: 4,
    });
    expect(bars.sales).toBe(10);
    expect(bars.rating).toBe((4 / 5) * 25);
    expect(bars.delivery).toBe(16);
    expect(bars.dispatch).toBe(12);
    expect(bars.quality).toBe(8);
    expect(bars.age).toBe(4);
  });

  it('prefers completedSales over totalSales for the sales bar fallback', () => {
    const bars = trustBarValues({
      trustScore: 50,
      totalSales: 40,
      completedSales: 12,
      averageRating: null,
    });
    expect(bars.sales).toBe(12);
    expect(bars.rating).toBe(0);
  });
});

describe('the tier pill', () => {
  it('renders human labels, never the raw enum', () => {
    expect(sellerTierLabel('NEW')).toBe('New seller');
    expect(sellerTierLabel('ESTABLISHED')).toBe('Established');
    expect(sellerTierLabel('TRUSTED')).toBe('Trusted');
    expect(sellerTierLabel('TOP_SELLER')).toBe('Top Seller');
    // ⚠️ Legacy value only: mapped so an old row renders a label, never described
    // in copy anywhere.
    expect(sellerTierLabel('DEALER')).toBe('Dealer');
    expect(Object.keys(SELLER_TIER_LABELS)).toContain('DEALER');
  });
});

describe('the rating average caption', () => {
  it('counts the whole history, not the recent slice', () => {
    expect(
      averageRatingCount({
        totalRatings: 84,
        recentRatings: [{}, {}, {}, {}, {}] as never,
      }),
    ).toBe(84);
  });

  it('falls back to the array length on an older backend', () => {
    expect(
      averageRatingCount({ recentRatings: [{}, {}] as never }),
    ).toBe(2);
  });
});
