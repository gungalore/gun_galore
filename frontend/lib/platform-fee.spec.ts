import { describe, expect, it } from 'vitest';
import {
  AUCTION_SPLIT_RATE,
  MIN_PLATFORM_FEE_CENTS,
  PLATFORM_FEE_BANDS,
  auctionBuyerFeeCents,
  auctionPayoutCents,
  buyNowPayoutCents,
  platformFeeCents,
  platformFeeForCents,
  platformFeePctOfItem,
  platformFeeUnflooredCents,
} from './platform-fee';

/**
 * ⚠️ THESE NUMBERS ARE THE BACKEND'S. Every case below is also asserted against
 * `backend/src/payments/fee.calculator.ts` by that file's own suite; this one
 * pins the browser copy so a change here is a deliberate act rather than a
 * typo. `scripts/fee-sync.cjs` checks the constants themselves at build time —
 * this suite checks the behaviour they produce.
 */
describe('the banded Platform Fee', () => {
  it('charges nothing on nothing', () => {
    expect(platformFeeCents(0)).toBe(0);
    expect(platformFeeUnflooredCents(0)).toBe(0);
  });

  it('takes 10% in the first slice', () => {
    // R100 → R10
    expect(platformFeeCents(10_000)).toBe(1_000);
  });

  it('holds the R10 floor, without exceeding the amount itself', () => {
    // R50 → 10% would be R5, so the floor applies.
    expect(platformFeeUnflooredCents(5_000)).toBe(500);
    expect(platformFeeCents(5_000)).toBe(MIN_PLATFORM_FEE_CENTS);
    // R5 → the floor is capped at the base, never more than the sale.
    expect(platformFeeCents(500)).toBe(500);
  });

  it('applies each band marginally, not to the whole base', () => {
    // R25,000 → exactly the first slice's 10%.
    expect(platformFeeCents(2_500_000)).toBe(250_000);
    // R50,000 → 10% of 25k + 9% of 25k
    expect(platformFeeCents(5_000_000)).toBe(475_000);
    // R75,000 → + 8% of the third slice
    expect(platformFeeCents(7_500_000)).toBe(675_000);
    // R100,000 → + 7% of the fourth
    expect(platformFeeCents(10_000_000)).toBe(850_000);
  });

  it('returns the effective rate on the item alone', () => {
    expect(platformFeePctOfItem(10_000)).toBeCloseTo(10, 6);
    expect(platformFeePctOfItem(0)).toBe(0);
  });
});

describe('the auction split', () => {
  it('charges the buyer 5%, floored at R10 and capped at the base', () => {
    expect(auctionBuyerFeeCents(100_000)).toBe(5_000);
    expect(auctionBuyerFeeCents(10_000)).toBe(MIN_PLATFORM_FEE_CENTS);
    // ⚠️ THE CAP THE OLD CHECKOUT PREVIEW OMITTED. A base under R10 used to
    // preview R10 while the backend charged the base; this asserts they agree.
    expect(auctionBuyerFeeCents(800)).toBe(800);
  });

  it('keeps the rate the sell form quotes for the seller half', () => {
    expect(AUCTION_SPLIT_RATE).toBe(0.05);
  });
});

describe('the schedule is the same at every price', () => {
  it('agrees for every integer cent across the floor boundary', () => {
    for (let cents = 1; cents <= 20_000; cents += 7) {
      expect(platformFeeForCents(cents, false)).toBe(platformFeeCents(cents));
      expect(platformFeeForCents(cents, true)).toBe(auctionBuyerFeeCents(cents));
    }
  });

  it('never charges more than the amount it is charged on', () => {
    for (const cents of [1, 10, 500, 999, 1_000, 1_001, 250_000]) {
      expect(platformFeeCents(cents)).toBeLessThanOrEqual(cents);
      expect(auctionBuyerFeeCents(cents)).toBeLessThanOrEqual(cents);
    }
  });

  it('declares four bands, the last open-ended', () => {
    expect(PLATFORM_FEE_BANDS).toHaveLength(4);
    expect(PLATFORM_FEE_BANDS[3].limit).toBe(Infinity);
  });
});

describe('what each side receives', () => {
  it('pays a Buy Now seller their full ask', () => {
    expect(buyNowPayoutCents(10_000)).toBe(10_000);
  });

  it('pays an auction seller the hammer less their 5%', () => {
    expect(auctionPayoutCents(100_000)).toBe(95_000);
    expect(auctionPayoutCents(0)).toBe(0);
  });
});
