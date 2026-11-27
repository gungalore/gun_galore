import { describe, expect, it } from 'vitest';
import { canAddToCart, showsStickyBuyBar } from './catalog-guards';

// ⚠️ AUCTIONS STAY SINGLE-ITEM. No cart trace, no cart-style sticky buy bar;
// bidding lives in the AuctionPanel. Collection-only/Private BUY_NOW lines ARE
// valid cart lines (task-8/ui-checkout).
describe('the auction guard', () => {
  it('never lets an auction into the cart', () => {
    expect(
      canAddToCart({ listingType: 'AUCTION', status: 'ACTIVE' }),
    ).toBe(false);
    expect(
      canAddToCart({ listingType: 'TAKE_A_SHOT', status: 'ACTIVE' }),
    ).toBe(false);
  });

  it('allows an ACTIVE BUY_NOW, including a collection-only one', () => {
    expect(canAddToCart({ listingType: 'BUY_NOW', status: 'ACTIVE' })).toBe(true);
    expect(
      canAddToCart({
        listingType: 'BUY_NOW',
        status: 'ACTIVE',
        collectionOnly: true,
        shippingMethods: ['COLLECTION'],
      }),
    ).toBe(true);
  });

  it('refuses anything not ACTIVE', () => {
    expect(canAddToCart({ listingType: 'BUY_NOW', status: 'SOLD' })).toBe(false);
  });
});

describe('the sticky mobile bar', () => {
  it('only appears for an ACTIVE BUY_NOW buy bar', () => {
    expect(
      showsStickyBuyBar(
        { listingType: 'BUY_NOW', status: 'ACTIVE' },
        { soldOut: false, isOwnListing: false },
      ),
    ).toBe(true);
    expect(
      showsStickyBuyBar(
        { listingType: 'AUCTION', status: 'ACTIVE' },
        { soldOut: false, isOwnListing: false },
      ),
    ).toBe(false);
  });

  it('keeps the owner’s Edit affordance on any active listing', () => {
    expect(
      showsStickyBuyBar(
        { listingType: 'AUCTION', status: 'ACTIVE' },
        { soldOut: false, isOwnListing: true },
      ),
    ).toBe(true);
  });

  it('disappears when sold out or not active', () => {
    expect(
      showsStickyBuyBar(
        { listingType: 'BUY_NOW', status: 'ACTIVE' },
        { soldOut: true, isOwnListing: false },
      ),
    ).toBe(false);
    expect(
      showsStickyBuyBar(
        { listingType: 'BUY_NOW', status: 'SOLD' },
        { soldOut: false, isOwnListing: false },
      ),
    ).toBe(false);
  });
});
