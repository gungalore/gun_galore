import { describe, expect, it } from 'vitest';
import {
  orderItemsForSeller,
  orderSellerRowMode,
  showsSellerRatingSection,
  visibleOrderSellers,
  type OrderSellerEntry,
} from './order-seller-ratings';

// ⚠️ A multi-seller order is rated ONCE, on the order page, one rating per
// seller. These are the three row states plus the "nothing to act on" case the
// page must not render.
const seller = (over: Partial<OrderSellerEntry> = {}): OrderSellerEntry => ({
  sellerId: 'seller-1',
  username: 'johan',
  transactionId: 'tx-1',
  canRate: false,
  rating: null,
  ...over,
});

const rating = {
  id: 'rating-1',
  stars: 5,
  comment: 'Good deal.',
  sellerResponse: null,
  sellerRespondedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  transactionId: 'tx-1',
};

describe('an order seller’s row', () => {
  it('offers the widget when the buyer can rate', () => {
    expect(orderSellerRowMode(seller({ canRate: true }))).toBe('rate');
  });

  it('shows a saved summary when a rating exists', () => {
    expect(orderSellerRowMode(seller({ rating }))).toBe('saved');
    // Even if the server also says canRate (a stale tab), the rating wins.
    expect(orderSellerRowMode(seller({ canRate: true, rating }))).toBe('saved');
  });

  it('waits while the items are still in transit', () => {
    expect(orderSellerRowMode(seller({ transactionId: 'tx-1' }))).toBe(
      'waiting',
    );
  });

  it('hides a seller with no transaction and no rating', () => {
    expect(orderSellerRowMode(seller({ transactionId: null }))).toBe('hidden');
    // …but a rating with no transaction is still worth showing read-only.
    expect(
      orderSellerRowMode(seller({ transactionId: null, rating })),
    ).toBe('saved');
  });
});

describe('the “Rate your sellers” section', () => {
  it('renders only when somebody can be rated or has been', () => {
    expect(showsSellerRatingSection([seller({ canRate: true })])).toBe(true);
    expect(showsSellerRatingSection([seller({ rating })])).toBe(true);
    expect(showsSellerRatingSection([seller()])).toBe(false);
    expect(showsSellerRatingSection([])).toBe(false);
    expect(showsSellerRatingSection(undefined)).toBe(false);
  });

  it('keeps waiting sellers beside the actionable ones, and drops nothing-rows', () => {
    const visible = visibleOrderSellers([
      seller({ sellerId: 'a', canRate: true }),
      seller({ sellerId: 'b' }),
      seller({ sellerId: 'c', transactionId: null }),
    ]);
    expect(visible.map((entry) => entry.sellerId)).toEqual(['a', 'b']);
  });

  it('matches a seller’s line items by their transaction id', () => {
    const lines = [
      { id: 'line-1', transaction: { id: 'tx-1' } },
      { id: 'line-2', transaction: { id: 'tx-2' } },
      { id: 'line-3', transaction: null },
    ];
    expect(
      orderItemsForSeller(lines, seller()).map((line) => line.id),
    ).toEqual(['line-1']);
    expect(
      orderItemsForSeller(lines, seller({ transactionId: null })),
    ).toEqual([]);
  });
});
