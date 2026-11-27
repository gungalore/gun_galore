import { allocateFee, allocateOrderFee, orderFeeBase } from './order-fee';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ONE PLATFORM FEE FOR THE CART, ALLOCATED BACK (operator, 2026-11-27).
 *
 * The FeeCalculator bands + R10 floor run ONCE on the aggregate; the per-line
 * child rows carry their fair share so a single-line refund returns the right
 * money. These tests pin: exact sum, proportional split, deterministic
 * largest-remainder tiebreak, and the base definition.
 * ────────────────────────────────────────────────────────────────────────────
 */

const bands = (base: number): number => {
  // Same marginal bands as FeeCalculator (10/9/8/7 across R25k slices, R10 floor).
  if (base === 0) return 0;
  let fee = 0;
  let remaining = base;
  for (const band of [
    { limit: 2_500_000, rate: 0.1 },
    { limit: 2_500_000, rate: 0.09 },
    { limit: 2_500_000, rate: 0.08 },
    { limit: Infinity, rate: 0.07 },
  ]) {
    if (remaining <= 0) break;
    const chunk = Math.min(remaining, band.limit);
    fee += chunk * band.rate;
    remaining -= chunk;
  }
  return Math.max(1_000, Math.round(fee));
};

describe('orderFeeBase', () => {
  it('sums item + shipping + legacy handling', () => {
    expect(
      orderFeeBase([
        { listingPrice: 10_000, shippingCost: 5_000, shippingHandlingCents: 0 },
        { listingPrice: 20_000, shippingCost: 0, shippingHandlingCents: 1_500 },
      ]),
    ).toBe(36_500);
  });
});

describe('allocateFee — largest remainder, exact', () => {
  it('splits proportionally to the bases', () => {
    expect(allocateFee([1_000, 2_000], 300)).toEqual([100, 200]);
  });

  it('sums to the total when the split is not exact', () => {
    // 10 cents over three equal bases: 3.33 each → [4,3,3] (lower index wins).
    const fees = allocateFee([1, 1, 1], 10);
    expect(fees).toEqual([4, 3, 3]);
    expect(fees.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('breaks a fractional tie by line index, deterministically', () => {
    expect(allocateFee([1, 1, 1], 2)).toEqual([1, 1, 0]);
    expect(allocateFee([1, 1, 1], 1)).toEqual([1, 0, 0]);
  });

  it('never allocates a negative fee', () => {
    expect(allocateFee([5_000, 1, 1], 7)).toEqual([7, 0, 0]);
  });

  it('is zero for a zero-value cart', () => {
    expect(allocateFee([0, 0], 0)).toEqual([0, 0]);
    expect(allocateFee([], 0)).toEqual([]);
  });

  it('refuses to lose cents on a zero-value cart with a fee', () => {
    expect(() => allocateFee([0, 0], 10)).toThrow(/zero-value/i);
  });
});

describe('allocateOrderFee', () => {
  it('applies the bands ONCE to the aggregate, then rewrites each line', () => {
    const allocation = allocateOrderFee(
      [
        { listingPrice: 10_000, shippingCost: 5_000, shippingHandlingCents: 0 },
        { listingPrice: 10_000, shippingCost: 5_000, shippingHandlingCents: 0 },
      ],
      bands,
    );

    // base 30,000 → fee 10% = 3,000 (applied ONCE to the aggregate).
    expect(allocation.base).toBe(30_000);
    expect(allocation.processingFee).toBe(3_000);
    expect(allocation.buyerTotal).toBe(33_000);
    expect(allocation.lines).toEqual([
      { base: 15_000, fee: 1_500, buyerTotal: 16_500 },
      { base: 15_000, fee: 1_500, buyerTotal: 16_500 },
    ]);
    // Every child's buyerTotal is its base + its allocated fee.
    expect(
      allocation.lines.reduce((sum, line) => sum + line.buyerTotal, 0),
    ).toBe(allocation.buyerTotal);
  });

  it('R10 floor is applied once, not once per line', () => {
    const allocation = allocateOrderFee(
      [
        { listingPrice: 2_000, shippingCost: 0, shippingHandlingCents: 0 },
        { listingPrice: 2_000, shippingCost: 0, shippingHandlingCents: 0 },
      ],
      bands,
    );
    // Aggregate 4,000: 10% = 400 is below the R10 floor → ONE R1,000 fee.
    expect(allocation.processingFee).toBe(1_000);
    expect(allocation.lines.reduce((sum, line) => sum + line.fee, 0)).toBe(
      1_000,
    );
  });

  it('refunds the allocated share for a single line', () => {
    const allocation = allocateOrderFee(
      [
        { listingPrice: 25_000, shippingCost: 0, shippingHandlingCents: 0 },
        { listingPrice: 75_000, shippingCost: 0, shippingHandlingCents: 0 },
      ],
      bands,
    );
    // child buyerTotal = base + its fee — the amount its refund path reverses.
    expect(allocation.lines[0].buyerTotal).toBe(
      allocation.lines[0].base + allocation.lines[0].fee,
    );
    expect(
      allocation.lines.reduce((sum, line) => sum + line.fee, 0),
    ).toBe(allocation.processingFee);
  });
});
