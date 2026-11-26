// ⚠️ FEE-PARITY GATE (2026-11 MARKETPLACE audit): these are the actual rand
// figures the Platform Fee produces. The frontend keeps a second copy of the
// schedule in `frontend/lib/platform-fee.ts`, held in sync by
// `scripts/fee-sync.cjs` — but that script only checks the CONSTANTS (bands,
// floor, auction rate). A change to the algorithm inside fee.calculator.ts
// would pass it and silently desync every displayed total from what we charge.
//
// These tests pin the CALCULATION, not the constants: band boundaries,
// marginal slices, Math.round, the R10 floor, the min(R10, base) cap, and the
// auction 5/5 split with its own floor/cap. If one of them changes, this fails
// and whoever changed it must also check the frontend — which is exactly the
// conversation the fee-sync gate cannot start.
import { FeeCalculator, BANDS, MIN_COMMISSION_CENTS, AUCTION_SPLIT_RATE } from './fee.calculator';

describe('FeeCalculator — the schedule itself', () => {
  // The frontend copy is parsed against these exported constants by
  // scripts/fee-sync.cjs; pinning them here catches an accidental edit that
  // the script's parser might not (e.g. a changed label or slice width).
  it('exposes the 10/9/8/7 schedule across R25,000 slices', () => {
    expect(BANDS).toEqual([
      { limit: 2_500_000, rate: 0.1, label: 'First R25,000 at 10%' },
      { limit: 2_500_000, rate: 0.09, label: 'R25,001–R50,000 at 9%' },
      { limit: 2_500_000, rate: 0.08, label: 'R50,001–R75,000 at 8%' },
      { limit: Infinity, rate: 0.07, label: 'Above R75,000 at 7%' },
    ]);
    expect(MIN_COMMISSION_CENTS).toBe(1_000);
    expect(AUCTION_SPLIT_RATE).toBe(0.05);
  });
});

describe('FeeCalculator.calculatePlatformFee — bands, rounding, floor, cap', () => {
  const fees = new FeeCalculator();

  it('charges nothing on a zero base', () => {
    expect(fees.calculatePlatformFee(0)).toBe(0);
    expect(fees.calculatePlatformFee(-10_000)).toBe(0);
  });

  it('treats the band limits as WIDTHS (marginal, not cumulative caps)', () => {
    // Exactly the first slice: 10% of R25,000.
    expect(fees.calculatePlatformFee(2_500_000)).toBe(250_000);
    // + R5,000 into the 9% slice.
    expect(fees.calculatePlatformFee(3_000_000)).toBe(295_000);
    // Exactly the first two slices.
    expect(fees.calculatePlatformFee(5_000_000)).toBe(475_000);
    // + R2,500 into the 8% slice.
    expect(fees.calculatePlatformFee(7_500_000)).toBe(675_000);
    // + R2,500 into the 7% slice.
    expect(fees.calculatePlatformFee(10_000_000)).toBe(850_000);
  });

  it('Math.rounds the marginal fee (including the first rand of a new slice)', () => {
    // R25,000.50 = 10% of R25,000 (250,000) + 9% of 50 cents (4.5) = 250,004.5
    // → rounded UP to 250,005. A floor/truncate would give 250,004.
    expect(fees.calculatePlatformFee(2_500_050)).toBe(250_005);
  });

  it('applies the R10 floor to small sales', () => {
    // 10% of R50 = R5, below the R10 floor (and the floor is below the base).
    expect(fees.calculatePlatformFee(5_000)).toBe(1_000);
    // R100 → 10% = R10 exactly, no bump needed.
    expect(fees.calculatePlatformFee(10_000)).toBe(1_000);
  });

  it('caps the floor at the base it is charged on (min(R10, base))', () => {
    // R8 sale: 10% = 80c → floored, but the floor may never exceed the base.
    expect(fees.calculatePlatformFee(800)).toBe(800);
    // R5 sale: 50c → floor bumped to R5 only because R5 < R10.
    expect(fees.calculatePlatformFee(500)).toBe(500);
  });

  it('charges the full banded fee once it clears the floor', () => {
    // R100.01: 10% = 1000.1c → rounded 1000, which is not < floor.
    expect(fees.calculatePlatformFee(10_001)).toBe(1_000);
    expect(fees.calculatePlatformFee(100_000)).toBe(10_000);
  });
});

describe('FeeCalculator.calculateAuctionFees — 5/5 split with floor/cap', () => {
  const fees = new FeeCalculator();

  it('splits 10% into 5% buyer (hammer + delivery) and 5% seller (hammer)', () => {
    expect(fees.calculateAuctionFees(100_000, 5_000)).toEqual({
      buyerFee: 5_250,
      sellerFee: 5_000,
    });
    // Delivery is in the BUYER's base only; the seller's 5% is hammer-only.
    expect(fees.calculateAuctionFees(200_000, 0)).toEqual({
      buyerFee: 10_000,
      sellerFee: 10_000,
    });
  });

  it('floors the buyer fee at R10 but caps it at the base', () => {
    // R10 hammer: 5% = 50c → floor lifts to R10 = the base.
    expect(fees.calculateAuctionFees(1_000, 0)).toEqual({
      buyerFee: 1_000,
      sellerFee: 50,
    });
    // R8 hammer: 5% = 40c → min(R10, R8 base) = R8, never more than the sale.
    expect(fees.calculateAuctionFees(800, 0)).toEqual({
      buyerFee: 800,
      sellerFee: 40,
    });
  });

  it('rounds both halves', () => {
    // R200.10: 5% = 1000.5c → clears the floor and rounds up on both sides.
    expect(fees.calculateAuctionFees(20_010)).toEqual({
      buyerFee: 1_001,
      sellerFee: 1_001,
    });
  });

  it('charges nothing when the hammer is zero', () => {
    expect(fees.calculateAuctionFees(0, 5_000)).toEqual({
      buyerFee: 0,
      sellerFee: 0,
    });
  });
});

describe('FeeCalculator.breakdownBuyNow — fee base is item × qty + delivery', () => {
  const fees = new FeeCalculator();

  it('adds the Platform Fee on (item + delivery); the seller receives the ask', () => {
    expect(fees.breakdownBuyNow(100_000, 5_000)).toEqual({
      listingPrice: 100_000,
      shippingCost: 5_000,
      shippingHandlingCents: 0,
      commissionZar: 0,
      processingFee: 10_500,
      buyerTotal: 115_500,
      sellerPayout: 100_000,
    });
  });

  it('multiplies the item by quantity but charges delivery once', () => {
    const b = fees.breakdownBuyNow(100_000, 5_000, 0, 2);
    expect(b.listingPrice).toBe(200_000);
    expect(b.processingFee).toBe(20_500);
    expect(b.buyerTotal).toBe(225_500);
    expect(b.sellerPayout).toBe(200_000);
  });

  it('counts a legacy handling margin as part of the delivery base', () => {
    const b = fees.breakdownBuyNow(100_000, 5_000, 500);
    expect(b.shippingHandlingCents).toBe(500);
    // Fee on 100,000 + 5,500.
    expect(b.processingFee).toBe(10_550);
    expect(b.buyerTotal).toBe(116_050);
  });

  it('keeps the floor capped when the item is free', () => {
    const b = fees.breakdownBuyNow(0, 5_000);
    // Fee on delivery alone: 10% of R50 = R5 → floored to R10, under the base.
    expect(b.processingFee).toBe(1_000);
    expect(b.buyerTotal).toBe(6_000);
    expect(b.sellerPayout).toBe(0);
  });
});

describe('FeeCalculator.breakdownAuction — buyer pays 5%, seller loses 5%', () => {
  const fees = new FeeCalculator();

  it('builds the winner checkout with the split', () => {
    expect(fees.breakdownAuction(100_000, 5_000)).toEqual({
      listingPrice: 100_000,
      shippingCost: 5_000,
      shippingHandlingCents: 0,
      commissionZar: 5_000,
      processingFee: 5_250,
      buyerTotal: 110_250,
      sellerPayout: 95_000,
    });
  });

  it('caps a sub-R10 buyer fee at the base and still deducts the seller half', () => {
    const b = fees.breakdownAuction(800, 0);
    expect(b.processingFee).toBe(800);
    expect(b.commissionZar).toBe(40);
    expect(b.buyerTotal).toBe(1_600);
    expect(b.sellerPayout).toBe(760);
  });

  it('is zero money on a zero hammer', () => {
    expect(fees.breakdownAuction(0, 0)).toEqual({
      listingPrice: 0,
      shippingCost: 0,
      shippingHandlingCents: 0,
      commissionZar: 0,
      processingFee: 0,
      buyerTotal: 0,
      sellerPayout: 0,
    });
  });
});

describe('FeeCalculator.listPriceFromSellerAsk — estimate only, ask unchanged', () => {
  const fees = new FeeCalculator();

  it('returns the seller ask unchanged and the fee on the item alone', () => {
    expect(fees.listPriceFromSellerAsk(100_000)).toEqual({
      sellerAsk: 100_000,
      commissionZar: 10_000,
      listPrice: 100_000,
    });
  });

  it('floors the estimate for a tiny ask', () => {
    // R50 ask: 10% = R5 → floor R10 (still under the R50 ask).
    expect(fees.listPriceFromSellerAsk(5_000)).toEqual({
      sellerAsk: 5_000,
      commissionZar: 1_000,
      listPrice: 5_000,
    });
  });
});
