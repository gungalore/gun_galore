import { describe, it, expect } from 'vitest';
import {
  AUCTION_DURATIONS,
  AUCTION_LOWEST_FLOOR_CENTS,
  auctionDurationsForReserve,
  auctionFloorViolation,
  auctionMinValueCents,
  auctionStartingBidCents,
  formatAuctionFloor,
  isAuctionDurationAllowed,
} from './auction-minimums';

// ────────────────────────────────────────────────────────────────────
// Sellers only type a reserve now. The opening bid is DERIVED as
// floor(reserve * 0.7) and the reserve is the figure every duration floor
// is measured against — the derived bid is deliberately allowed below a
// floor ("it can fall below the value"). Two traps this locks:
//
//   1. The floor is on the RESERVE, never on the derived opening bid.
//   2. BACKWARDS IS ALLOWED: the band is a minimum, so a high reserve can
//      choose any SHORTER duration (R20,000 → 3 days), while a reserve
//      below a duration's floor cannot pick that duration (R2,500 ≠ 7 days).
// ────────────────────────────────────────────────────────────────────

describe('auction minimums — the numbers', () => {
  it('prints the four durations with their reserve floors', () => {
    expect(AUCTION_DURATIONS.map((d) => [d.days, d.minCents])).toEqual([
      [3, 250_000],
      [5, 500_000],
      [7, 750_000],
      [14, 1_000_000],
    ]);
  });

  it('labels each pill with the floor it enforces', () => {
    // The sublabel is what the seller reads; a mismatch between it and the
    // enforced figure is a claim the gate does not honour.
    expect(AUCTION_DURATIONS.map((d) => d.sublabel)).toEqual([
      'min R2,500',
      'min R5,000',
      'min R7,500',
      'min R10,000',
    ]);
    for (const d of AUCTION_DURATIONS) {
      expect(d.sublabel).toBe(`min ${formatAuctionFloor(d.minCents)}`);
    }
  });

  it('resolves a floor from a string or a number, and null when unset', () => {
    expect(auctionMinValueCents('3')).toBe(250_000);
    expect(auctionMinValueCents(14)).toBe(1_000_000);
    expect(auctionMinValueCents('')).toBeNull();
    expect(auctionMinValueCents(null)).toBeNull();
    expect(auctionMinValueCents(undefined)).toBeNull();
    // A duration the picker cannot offer has no floor rather than a guess.
    expect(auctionMinValueCents('30')).toBeNull();
  });

  it('formats a floor as whole rand', () => {
    expect(formatAuctionFloor(1_000_000)).toBe('R10,000');
    expect(formatAuctionFloor(100_000)).toBe('R1,000');
  });

  it('exposes the lowest floor as the no-auction-can-run-below number', () => {
    expect(AUCTION_LOWEST_FLOOR_CENTS).toBe(250_000);
    expect(formatAuctionFloor(AUCTION_LOWEST_FLOOR_CENTS)).toBe('R2,500');
  });
});

describe('auction minimums — the derived opening bid (30% below reserve)', () => {
  it('derives floor(reserve * 0.7) in cents', () => {
    expect(auctionStartingBidCents(250_000)).toBe(175_000);
    expect(auctionStartingBidCents(1_000_000)).toBe(700_000);
    // Whole cents: 0.7 of an odd reserve truncates, it never rounds up.
    expect(auctionStartingBidCents(249_999)).toBe(174_999);
    expect(auctionStartingBidCents(1)).toBe(0);
  });

  it('has no opening bid without a reserve', () => {
    // Auctions require a reserve now, so blank / invalid input is 0 rather
    // than a phantom figure on the read-only line.
    expect(auctionStartingBidCents(0)).toBe(0);
    expect(auctionStartingBidCents(-1)).toBe(0);
    expect(auctionStartingBidCents(Number.NaN)).toBe(0);
    expect(auctionStartingBidCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('the derived bid may sit below the floor — the reserve is what counts', () => {
    // Reserve R2,500 on a 3-day run → derived start R1,750. The start is
    // 30% below the floor by design; the reserve clears it.
    expect(auctionStartingBidCents(250_000)).toBe(175_000);
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 250_000 }),
    ).toBeNull();
  });
});

describe('auction minimums — which durations a reserve unlocks', () => {
  it('a R2,500 reserve unlocks only 3 days', () => {
    expect(auctionDurationsForReserve(250_000).map((d) => d.days)).toEqual([3]);
    expect(isAuctionDurationAllowed(3, 250_000)).toBe(true);
    // Below a floor → that duration is locked out.
    expect(isAuctionDurationAllowed(5, 250_000)).toBe(false);
    expect(isAuctionDurationAllowed(7, 250_000)).toBe(false);
    expect(isAuctionDurationAllowed(14, 250_000)).toBe(false);
  });

  it('a R20,000 reserve can pick ANY length, including the shortest', () => {
    // BACKWARDS IS ALLOWED: a bigger reserve is never forced into a longer
    // run — the band is a minimum, not an exact fit.
    expect(auctionDurationsForReserve(2_000_000).map((d) => d.days)).toEqual([
      3, 5, 7, 14,
    ]);
    for (const days of [3, 5, 7, 14]) {
      expect(isAuctionDurationAllowed(days, 2_000_000)).toBe(true);
    }
  });

  it('a reserve exactly on a floor unlocks that duration and every shorter one', () => {
    expect(auctionDurationsForReserve(1_000_000).map((d) => d.days)).toEqual([
      3, 5, 7, 14,
    ]);
    expect(isAuctionDurationAllowed(14, 1_000_000)).toBe(true);
    expect(auctionDurationsForReserve(750_000).map((d) => d.days)).toEqual([
      3, 5, 7,
    ]);
    expect(isAuctionDurationAllowed(14, 750_000)).toBe(false);
  });

  it('a blank reserve blocks every duration — an auction needs a reserve', () => {
    expect(auctionDurationsForReserve(0)).toEqual([]);
    for (const days of [3, 5, 7, 14]) {
      expect(isAuctionDurationAllowed(days, 0)).toBe(false);
    }
    expect(isAuctionDurationAllowed('3', Number.NaN)).toBe(false);
  });

  it('rejects a duration the picker cannot offer', () => {
    expect(isAuctionDurationAllowed('30', 2_000_000)).toBe(false);
    expect(isAuctionDurationAllowed('', 2_000_000)).toBe(false);
    expect(isAuctionDurationAllowed(null, 2_000_000)).toBe(false);
    expect(isAuctionDurationAllowed(undefined, 2_000_000)).toBe(false);
  });
});

describe('auction minimums — the floor is measured on the reserve', () => {
  it('passes when the reserve clears the floor', () => {
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 250_000 }),
    ).toBeNull();
    expect(
      auctionFloorViolation({ durationDays: '14', reserveCents: 1_000_000 }),
    ).toBeNull();
  });

  it('blocks a reserve below the floor and names the minimum reserve', () => {
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 249_999 }),
    ).toEqual({ minCents: 250_000 });
    expect(
      auctionFloorViolation({ durationDays: '7', reserveCents: 500_000 }),
    ).toEqual({ minCents: 750_000 });
  });

  it('stays silent until there is a reserve to judge', () => {
    // A blank reserve is blocked by the required-field check, not by a
    // "below the floor" message over a field the seller has not filled in.
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 0 }),
    ).toBeNull();
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: Number.NaN }),
    ).toBeNull();
    // And with no duration chosen there is nothing to measure against.
    expect(
      auctionFloorViolation({ durationDays: '', reserveCents: 50 }),
    ).toBeNull();
    expect(
      auctionFloorViolation({ durationDays: null, reserveCents: 50 }),
    ).toBeNull();
  });

  it('scales with the duration — the same reserve passes 3 days and fails 14', () => {
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 300_000 }),
    ).toBeNull();
    expect(
      auctionFloorViolation({ durationDays: '14', reserveCents: 300_000 }),
    ).toEqual({ minCents: 1_000_000 });
  });
});
