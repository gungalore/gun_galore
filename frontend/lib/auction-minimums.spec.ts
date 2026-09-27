import { describe, it, expect } from 'vitest';
import {
  AUCTION_DURATIONS,
  auctionFloorViolation,
  auctionMinValueCents,
  formatAuctionFloor,
} from './auction-minimums';

// ────────────────────────────────────────────────────────────────────
// A longer auction costs more to run, so each duration carries a minimum
// value the item must advertise. The trap this locks is WHICH figure the
// floor is measured against: the reserve (or the starting bid the seller
// typed when there is no reserve), NEVER the derived 30%-under starting
// bid. The operator was explicit that the 30% figure "can fall below the
// value" — so a set reserve of R1,000 with the resulting R700 start must
// pass a 3-day floor of R1,000.
// ────────────────────────────────────────────────────────────────────

describe('auction minimums — the numbers', () => {
  it('prints the four durations with their floors', () => {
    expect(AUCTION_DURATIONS.map((d) => [d.days, d.minCents])).toEqual([
      [3, 100_000],
      [5, 250_000],
      [7, 600_000],
      [14, 1_000_000],
    ]);
  });

  it('labels each pill with the floor it enforces', () => {
    // The sublabel is what the seller reads; a mismatch between it and the
    // enforced figure is a claim the gate does not honour.
    expect(AUCTION_DURATIONS.map((d) => d.sublabel)).toEqual([
      'min R1,000',
      'min R2,500',
      'min R6,000',
      'min R10,000',
    ]);
    for (const d of AUCTION_DURATIONS) {
      expect(d.sublabel).toBe(`min ${formatAuctionFloor(d.minCents)}`);
    }
  });

  it('resolves a floor from a string or a number, and null when unset', () => {
    expect(auctionMinValueCents('3')).toBe(100_000);
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
});

describe('auction minimums — the floor is on the reserve, not the derived bid', () => {
  it('passes when the reserve clears the floor even though the 30% start is below it', () => {
    // Reserve R1,000 on a 3-day run → derived start R700 (30% under).
    // The start is below R1,000 by design; the reserve is what counts.
    const start = Math.floor(100_000 * 0.7);
    expect(start).toBeLessThan(100_000);
    expect(
      auctionFloorViolation({
        durationDays: '3',
        reserveCents: 100_000,
        startingBidCents: start,
      }),
    ).toBeNull();
  });

  it('blocks a reserve below the floor', () => {
    expect(
      auctionFloorViolation({
        durationDays: '3',
        reserveCents: 99_999,
        startingBidCents: 0,
      }),
    ).toEqual({ field: 'reserve', minCents: 100_000 });
  });

  it('blocks a typed starting bid below the floor when there is no reserve', () => {
    expect(
      auctionFloorViolation({
        durationDays: '7',
        reserveCents: 0,
        startingBidCents: 599_999,
      }),
    ).toEqual({ field: 'startingBid', minCents: 600_000 });
  });

  it('lets a typed starting bid clear the floor when there is no reserve', () => {
    expect(
      auctionFloorViolation({
        durationDays: '7',
        reserveCents: 0,
        startingBidCents: 600_000,
      }),
    ).toBeNull();
  });

  it('names the reserve as the offender when a reserve is set, even if the start is also low', () => {
    // Reserve wins: the seller staked the reserve, so that is the figure
    // the message must name.
    expect(
      auctionFloorViolation({
        durationDays: '14',
        reserveCents: 500_000,
        startingBidCents: 100,
      }),
    ).toEqual({ field: 'reserve', minCents: 1_000_000 });
  });

  it('stays silent until there is a figure to judge', () => {
    // A floor over an empty form would grey the button before the seller
    // has typed anything, which the wizard footer treats as "work missing".
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 0, startingBidCents: 0 }),
    ).toBeNull();
    // And with no duration chosen there is nothing to measure against.
    expect(
      auctionFloorViolation({ durationDays: '', reserveCents: 50, startingBidCents: 50 }),
    ).toBeNull();
  });

  it('scales with the duration — the same reserve passes 3 days and fails 14', () => {
    expect(
      auctionFloorViolation({ durationDays: '3', reserveCents: 300_000, startingBidCents: 0 }),
    ).toBeNull();
    expect(
      auctionFloorViolation({ durationDays: '14', reserveCents: 300_000, startingBidCents: 0 }),
    ).toEqual({ field: 'reserve', minCents: 1_000_000 });
  });
});
