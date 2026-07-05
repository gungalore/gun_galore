import { FeeCalculator } from './fee.calculator';

// EXP-E1 — breakdownExperience: full-value-held hunting-package booking.
// Commission uses the SAME tiered bands as goods; shipping + handling are
// always ZERO (no courier, no waybill); the manual 1.5% processing fee passes
// through. These tests lock the money identity, the R0 shipping/handling
// invariant, and band parity with breakdown() for the same price.
describe('FeeCalculator.breakdownExperience', () => {
  const fc = new FeeCalculator();

  it('R0 shipping AND R0 handling for an on-site service (no courier / no waybill)', () => {
    const b = fc.breakdownExperience(2_500_000, true, false, 'manual'); // R25,000
    expect(b.shippingCost).toBe(0);
    expect(b.shippingHandlingCents).toBe(0);
  });

  it('band parity with breakdown() for the same price (standard tiered bands, NOT a flat rate)', () => {
    // Same price, buyer pays fee, no shipping/handling → the two must agree on
    // commission + processing + buyerTotal + sellerPayout.
    for (const price of [5_000, 500_000, 2_000_000, 2_500_000, 15_000_000]) {
      const exp = fc.breakdownExperience(price, true, false, 'manual');
      const goods = fc.breakdown(price, true, false, 0, 'manual', 0);
      expect(exp.commissionZar).toBe(goods.commissionZar);
      expect(exp.processingFee).toBe(goods.processingFee);
      expect(exp.buyerTotal).toBe(goods.buyerTotal);
      expect(exp.sellerPayout).toBe(goods.sellerPayout);
    }
  });

  it('money identity (buyer pays fee): buyerTotal − processingFee − commission == sellerPayout', () => {
    const price = 2_500_000; // R25,000
    const b = fc.breakdownExperience(price, true, false, 'manual');
    // buyerTotal = price + processingFee; sellerPayout = price − commission.
    expect(b.buyerTotal).toBe(price + b.processingFee);
    expect(b.buyerTotal - b.processingFee - b.commissionZar).toBe(b.sellerPayout);
  });

  it('money identity (seller absorbs fee): buyerTotal == price, sellerPayout == price − commission − processingFee', () => {
    const price = 2_500_000;
    const b = fc.breakdownExperience(price, false, false, 'manual');
    expect(b.buyerTotal).toBe(price);
    expect(b.sellerPayout).toBe(price - b.commissionZar - b.processingFee);
  });

  it('manual processing fee is a flat 1.5% pass-through on the package price', () => {
    const price = 2_500_000;
    const b = fc.breakdownExperience(price, true, false, 'manual');
    expect(b.processingFee).toBe(Math.round(price * 0.015)); // R375
  });

  it('R25,000 / 4-slot reference package (the two-account E2E figure)', () => {
    const price = 2_500_000; // R25,000
    const b = fc.breakdownExperience(price, true, false, 'manual');
    // Tax-bracket bands (each limit is the WIDTH of the slice):
    //   R5,000 @ 9%  = R450   (band 1, limit R5,000)
    //   R15,000 @ 7% = R1,050 (band 2, limit R5,001–R20,000 → R15,000 wide)
    //   R5,000 @ 5%  = R250   (band 3, R20,001–R25,000)
    //   total = R1,750 = 175,000c — SAME bands as goods, not a flat rate.
    expect(b.commissionZar).toBe(175_000);
    expect(b.processingFee).toBe(37_500); // 1.5% of R25,000 = R375
    expect(b.buyerTotal).toBe(price + 37_500);
    expect(b.sellerPayout).toBe(price - 175_000);
    expect(b.shippingCost).toBe(0);
    expect(b.shippingHandlingCents).toBe(0);
  });

  it('R30 minimum commission floor still applies on a tiny package', () => {
    const price = 10_000; // R100 → 9% = R9 < R30 floor
    const b = fc.breakdownExperience(price, true, false, 'manual');
    expect(b.commissionZar).toBe(3_000); // R30 floor
  });

  it('clamps a negative price to zero (no negative held value)', () => {
    const b = fc.breakdownExperience(-1, true, false, 'manual');
    expect(b.listingPrice).toBe(0);
    expect(b.commissionZar).toBe(0);
    expect(b.sellerPayout).toBe(0);
  });
});
