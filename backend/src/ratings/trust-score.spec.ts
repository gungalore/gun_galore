import {
  DISPATCH_DEFAULT_POINTS,
  TRUST_COMPONENT_MAX,
  computeTrust,
  tierFor,
  type TrustComponents,
  type TrustTransactionRow,
} from './trust-score';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE SELLER TRUST SCORE (audit, 2026-11-27).
 *
 * The dashboard used to fabricate four of its six bars client-side, and the
 * delivery component divided by EVERY non-refunded transaction — in-flight
 * orders and unconverted collections included — while only counting DELIVERED.
 * These specs pin the corrected rule: a sale is COMPLETE when payment is
 * RELEASED and it is not a swap leg; delivery success is over those sales, and
 * COLLECTED is a success.
 * ────────────────────────────────────────────────────────────────────────────
 */

const NOW = new Date('2026-11-27T12:00:00Z');
const OLD_ACCOUNT = new Date('2022-01-01T00:00:00Z'); // > 2 years → full age
const PAID = new Date('2026-11-01T08:00:00Z');

function sold(
  overrides: Partial<TrustTransactionRow> = {},
): TrustTransactionRow {
  return {
    paymentStatus: 'RELEASED',
    shippingStatus: 'DELIVERED',
    paidAt: PAID,
    dispatchedAt: new Date(PAID.getTime() + 20 * 3_600_000), // <24h → 15
    swapId: null,
    rating: { stars: 5 },
    ...overrides,
  };
}

const FULL_QUALITY = [{ claudeConfidence: 1 }];

function sum(components: TrustComponents): number {
  return Object.values(components).reduce((total, value) => total + value, 0);
}

describe('computeTrust — the six components', () => {
  it('scores a completed courier sale from the real points', () => {
    const result = computeTrust({
      transactions: [sold()],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });

    expect(result.completedSales).toBe(1);
    expect(result.averageRating).toBe(5);
    expect(result.components).toEqual({
      sales: 1,
      rating: 25,
      delivery: 20,
      dispatch: 15,
      quality: 10,
      age: 5,
    });
    expect(result.trustScore).toBe(76);
    // The components reconcile to the integer score the database stores.
    expect(Math.round(sum(result.components))).toBe(result.trustScore);
    // One sale is below the ESTABLISHED volume gate regardless of score.
    expect(result.tier).toBe('NEW');
  });

  it('counts a COLLECTED firearm sale as a delivery success', () => {
    // ⚠️ A collection is never stamped DELIVERED. Dividing by all transactions
    // and counting only DELIVERED scored every firearm-only seller 0/20.
    const result = computeTrust({
      transactions: [sold({ shippingStatus: 'COLLECTED' })],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.components.delivery).toBe(20);
  });

  it('ignores an in-flight HELD order in every count', () => {
    const result = computeTrust({
      transactions: [
        sold(),
        sold({ paymentStatus: 'HELD', shippingStatus: 'DELIVERED' }),
      ],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.completedSales).toBe(1);
    expect(result.components.sales).toBe(1);
    expect(result.components.delivery).toBe(20);
    expect(result.components.dispatch).toBe(15);
    expect(result.averageRating).toBe(5);
  });

  it('ignores swap synthetic rows completely', () => {
    const result = computeTrust({
      transactions: [
        sold(),
        sold({ swapId: 'swap-leg-1', shippingStatus: 'COLLECTED' }),
      ],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.completedSales).toBe(1);
    expect(result.components.delivery).toBe(20);
    expect(result.components.rating).toBe(25);
  });

  it('ignores a refunded row', () => {
    const result = computeTrust({
      transactions: [sold(), sold({ paymentStatus: 'REFUNDED' })],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.completedSales).toBe(1);
    expect(result.components.sales).toBe(1);
  });

  it('gives delivery 0, not a perfect score, when nothing has been released', () => {
    const result = computeTrust({
      transactions: [sold({ paymentStatus: 'HELD' })],
      listings: [],
      createdAt: NOW,
      now: NOW,
    });
    expect(result.completedSales).toBe(0);
    expect(result.components).toEqual({
      sales: 0,
      rating: 0,
      delivery: 0,
      // ⚠️ DOCUMENTED DEFAULT: no dispatch history is neither a reward nor a
      // punishment.
      dispatch: DISPATCH_DEFAULT_POINTS,
      quality: 5, // no listings → 0.5 confidence × 10
      age: 0,
    });
    expect(result.trustScore).toBe(13);
    expect(result.averageRating).toBeNull();
    expect(result.tier).toBe('NEW');
  });

  it('caps every component at its maximum', () => {
    const result = computeTrust({
      transactions: Array.from({ length: 40 }, () => sold()),
      listings: Array.from({ length: 5 }, () => ({ claudeConfidence: 1 })),
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.components).toEqual(TRUST_COMPONENT_MAX);
    expect(result.trustScore).toBe(100);
    expect(result.tier).toBe('TOP_SELLER');
  });

  it('rounds the average rating to one decimal', () => {
    const result = computeTrust({
      transactions: [
        sold({ rating: { stars: 4 } }),
        sold({ rating: { stars: 5 } }),
        sold({ rating: { stars: 4 } }),
      ],
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.averageRating).toBe(4.3);
    expect(result.components.rating).toBe(21.67);
  });

  it('bands dispatch speed exactly as before', () => {
    const at = (hours: number) =>
      computeTrust({
        transactions: [
          sold({
            dispatchedAt: new Date(PAID.getTime() + hours * 3_600_000),
          }),
        ],
        listings: FULL_QUALITY,
        createdAt: OLD_ACCOUNT,
        now: NOW,
      }).components.dispatch;
    expect(at(23)).toBe(15);
    expect(at(24)).toBe(10);
    expect(at(47)).toBe(10);
    expect(at(48)).toBe(5);
    expect(at(71)).toBe(5);
    expect(at(72)).toBe(0);
  });
});

describe('tierFor — the bands are unchanged', () => {
  it('uses volume AND score, exactly 3/50, 10/70, 25/85', () => {
    expect(tierFor(2, 100)).toBe('NEW');
    expect(tierFor(3, 49)).toBe('NEW');
    expect(tierFor(3, 50)).toBe('ESTABLISHED');
    expect(tierFor(9, 100)).toBe('ESTABLISHED');
    expect(tierFor(10, 69)).toBe('ESTABLISHED');
    expect(tierFor(10, 70)).toBe('TRUSTED');
    expect(tierFor(24, 100)).toBe('TRUSTED');
    expect(tierFor(25, 84)).toBe('TRUSTED');
    expect(tierFor(25, 85)).toBe('TOP_SELLER');
  });

  it('does not promote on a high score alone', () => {
    // 30 perfect sales but a 1★ average: volume met, score not.
    const result = computeTrust({
      transactions: Array.from({ length: 30 }, () =>
        sold({ rating: { stars: 1 } }),
      ),
      listings: FULL_QUALITY,
      createdAt: OLD_ACCOUNT,
      now: NOW,
    });
    expect(result.components.rating).toBe(5);
    expect(result.trustScore).toBe(80);
    expect(result.tier).toBe('TRUSTED');
  });
});
