import { BadRequestException } from '@nestjs/common';
import {
  computeOrderTotals,
  lineSubtotal,
  assertSingleSeller,
  assertNoDuplicateListings,
  OrderLineBreakdown,
} from './order-math';

const line = (o: Partial<OrderLineBreakdown>): OrderLineBreakdown => ({
  unitPrice: 10_000,
  quantity: 1,
  listingPrice: 10_000,
  shippingCost: 5_000,
  processingFee: 150,
  buyerTotal: 15_000,
  ...o,
});

describe('order-math.computeOrderTotals', () => {
  it('returns a single line verbatim', () => {
    const t = computeOrderTotals([line({})]);
    expect(t).toEqual({
      itemsSubtotal: 10_000,
      shippingSubtotal: 5_000,
      processingFee: 150,
      buyerTotal: 15_000,
    });
  });

  it('sums multiple lines (the buyer pays the exact sum of line totals)', () => {
    const t = computeOrderTotals([
      line({ listingPrice: 10_000, shippingCost: 5_000, processingFee: 150, buyerTotal: 15_000 }),
      line({ listingPrice: 25_000, shippingCost: 7_000, processingFee: 375, buyerTotal: 32_000 }),
    ]);
    expect(t.itemsSubtotal).toBe(35_000);
    expect(t.shippingSubtotal).toBe(12_000);
    expect(t.processingFee).toBe(525);
    expect(t.buyerTotal).toBe(47_000);
  });

  it('handles a multi-unit line (listingPrice already = unitPrice × qty)', () => {
    const t = computeOrderTotals([
      line({ unitPrice: 10_000, quantity: 3, listingPrice: 30_000, buyerTotal: 35_000 }),
    ]);
    expect(t.itemsSubtotal).toBe(30_000);
    expect(t.buyerTotal).toBe(35_000);
  });

  it('throws on an empty cart', () => {
    expect(() => computeOrderTotals([])).toThrow(BadRequestException);
  });

  it('throws on non-integer cents', () => {
    expect(() => computeOrderTotals([line({ buyerTotal: 15_000.5 })])).toThrow(
      BadRequestException,
    );
  });
});

describe('order-math.lineSubtotal', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineSubtotal(12_500, 4)).toBe(50_000);
  });
  it('rejects quantity < 1', () => {
    expect(() => lineSubtotal(12_500, 0)).toThrow(BadRequestException);
  });
  it('rejects a fractional quantity', () => {
    expect(() => lineSubtotal(12_500, 1.5)).toThrow(BadRequestException);
  });
});

describe('order-math.assertSingleSeller', () => {
  it('returns the seller when all lines share one', () => {
    expect(assertSingleSeller(['S1', 'S1', 'S1'])).toBe('S1');
  });
  it('throws when the cart spans sellers (8d, not 8b)', () => {
    expect(() => assertSingleSeller(['S1', 'S2'])).toThrow(BadRequestException);
  });
  it('throws on an empty cart', () => {
    expect(() => assertSingleSeller([])).toThrow(BadRequestException);
  });
});

describe('order-math.assertNoDuplicateListings', () => {
  it('passes distinct listings', () => {
    expect(() => assertNoDuplicateListings(['L1', 'L2', 'L3'])).not.toThrow();
  });
  it('throws on a duplicate listing', () => {
    expect(() => assertNoDuplicateListings(['L1', 'L2', 'L1'])).toThrow(
      BadRequestException,
    );
  });
});
