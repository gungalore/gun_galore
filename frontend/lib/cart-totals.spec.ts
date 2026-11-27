import { describe, expect, it } from 'vitest';
import {
  cartItemsSubtotalCents,
  cartLineSubtotalCents,
  cartTotals,
  cartTotalsAfterRemoval,
  cartTotalsForItems,
  wholeCents,
} from './cart-totals';
import { platformFeeCents } from './platform-fee';

// ─────────────────────────────────────────────────────────────────────
// APPROVED RULE (operator 2026-11-27): the Platform Fee is charged ONCE on
// the whole cart base = items subtotal + delivery, NOT once per item and not
// once per seller group. These specs pin the aggregate, the floor-once
// behaviour and the local remove recalculation.
// ─────────────────────────────────────────────────────────────────────

const line = (price: number, quantity = 1) => ({ price, quantity });

describe('cart line + subtotal arithmetic', () => {
  it('multiplies unit price by quantity', () => {
    expect(cartLineSubtotalCents(line(19_999, 3))).toBe(59_997);
  });

  it('treats missing/garbage quantities as one unit', () => {
    expect(cartLineSubtotalCents({ price: 1_000 })).toBe(1_000);
    expect(cartLineSubtotalCents({ price: 1_000, quantity: 0 })).toBe(1_000);
  });

  it('sums every line', () => {
    expect(cartItemsSubtotalCents([line(10_000), line(5_000, 2)])).toBe(
      20_000,
    );
  });

  it('sanitises untrusted cents', () => {
    expect(wholeCents(undefined)).toBe(0);
    expect(wholeCents(-500)).toBe(0);
    expect(wholeCents(12.6)).toBe(13);
  });
});

describe('the whole-cart platform fee is charged ONCE', () => {
  it('prices the fee on items + delivery, not per item', () => {
    // Two cheap lines from DIFFERENT sellers: the per-item fee would floor
    // twice (R20); the approved cart fee floors once on the R180 base.
    const items = cartItemsSubtotalCents([
      line(9_000),
      line(9_000),
    ]);
    const totals = cartTotals(items, 0);
    expect(totals.itemsSubtotalCents).toBe(18_000);
    expect(totals.platformFeeCents).toBe(platformFeeCents(18_000));
    expect(totals.platformFeeCents).toBe(platformFeeCents(18_000));
  });

  it('includes delivery in the fee base', () => {
    const items = 100_000;
    const shipping = 15_000;
    const totals = cartTotals(items, shipping);
    expect(totals.platformFeeCents).toBe(platformFeeCents(115_000));
    // …which is strictly more than the fee on items alone.
    expect(totals.platformFeeCents).toBeGreaterThan(
      platformFeeCents(items),
    );
    expect(totals.totalCents).toBe(items + shipping + totals.platformFeeCents);
  });

  it('applies the R10 floor once, not once per line', () => {
    // 4 × R50 = R200 base → 10% = R20 (above floor). Per-item floors would be
    // 4 × R10 = R40; the aggregate is the only correct number.
    const totals = cartTotals(4 * 5_000, 0);
    expect(totals.platformFeeCents).toBe(2_000);
  });

  it('keeps the band schedule (marginal bands) on the aggregate', () => {
    // R30,000 base: first R25,000 at 10% (R2,500) + R5,000 at 9% (R450).
    const totals = cartTotals(3_000_000, 0);
    expect(totals.platformFeeCents).toBe(295_000);
  });

  it('is all zeros for an empty cart — never a lone floor', () => {
    expect(cartTotals(0, 0)).toEqual({
      itemsSubtotalCents: 0,
      shippingCents: 0,
      platformFeeCents: 0,
      totalCents: 0,
    });
    expect(cartTotalsForItems([])).toEqual(cartTotals(0, 0));
  });

  it('sums the chosen per-seller courier rows into the shipping base', () => {
    const totals = cartTotalsForItems([line(50_000), line(50_000)], 25_000);
    expect(totals.shippingCents).toBe(25_000);
    expect(totals.platformFeeCents).toBe(platformFeeCents(125_000));
    expect(totals.totalCents).toBe(125_000 + platformFeeCents(125_000));
  });
});

describe('local remove recalculation', () => {
  const items = [
    { listingId: 'a', price: 10_000, quantity: 1 },
    { listingId: 'b', price: 20_000, quantity: 2 },
    { listingId: 'c', price: 30_000, quantity: 1 },
  ];

  it('drops the line and re-prices the fee + total instantly', () => {
    const before = cartTotalsForItems(items, 15_000);
    // Removing the R20,000 seller group's only courier parcel drops that
    // group's shipping with it.
    const after = cartTotalsAfterRemoval(items, 'b', 0);
    expect(after.remainingItems).toBe(2);
    expect(after.itemsSubtotalCents).toBe(40_000);
    expect(after.platformFeeCents).toBe(platformFeeCents(40_000));
    expect(after.totalCents).toBe(40_000 + platformFeeCents(40_000));
    expect(after.totalCents).toBeLessThan(before.totalCents);
  });

  it('keeps the remaining seller’s courier row when a sibling item is removed', () => {
    const after = cartTotalsAfterRemoval(items, 'a', 15_000);
    expect(after.shippingCents).toBe(15_000);
    expect(after.totalCents).toBe(
      70_000 + 15_000 + platformFeeCents(85_000),
    );
  });

  it('empties to zero when the last line is removed', () => {
    const after = cartTotalsAfterRemoval(
      [{ listingId: 'only', price: 50_000 }],
      'only',
      0,
    );
    expect(after).toEqual({
      itemsSubtotalCents: 0,
      shippingCents: 0,
      platformFeeCents: 0,
      totalCents: 0,
      remainingItems: 0,
    });
  });
});
