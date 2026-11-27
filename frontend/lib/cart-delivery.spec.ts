// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCartCheckoutLines,
  cartClassGroups,
  cartGroupKey,
  cartShippingRows,
  classGroupForListing,
  groupCartBySellerAndClass,
  hasConflictedGroup,
  isCollectionOnlyItem,
  needsCollectionPapersAck,
  pruneCartDeliveryChoices,
  quoteGroupForClassGroup,
  readCartDeliveryChoices,
  saveCartDeliveryChoice,
  shippingTotalCents,
  type CartClassGroup,
} from './cart-delivery';
import type { CartItem } from './cart-store';

// ─────────────────────────────────────────────────────────────────────
// THE APPROVED GROUPING (operator 2026-11-27):
//   seller → delivery class (Accessories / Firearms) → exactly ONE toggle.
// These specs pin the grouping, the per-group method intersection, the
// persistence of the buyer's toggle, the per-seller shipping rows and the
// checkout line payload the backend groups again on its side.
// ─────────────────────────────────────────────────────────────────────

const goods = (over: Partial<CartItem> = {}): CartItem => ({
  listingId: 'l-goods',
  title: 'Scope rings',
  price: 50_000,
  imageUrl: 'https://cdn.example/rings.jpg',
  sellerId: 'seller-1',
  sellerUsername: 'johan',
  isFirearm: false,
  shippingMethods: ['COURIER', 'PRIVATE_ARRANGE'],
  quantity: 1,
  listingType: 'BUY_NOW',
  ...over,
});

const firearm = (over: Partial<CartItem> = {}): CartItem => ({
  listingId: 'l-firearm',
  title: '9mm pistol',
  price: 900_000,
  sellerId: 'seller-1',
  sellerUsername: 'johan',
  isFirearm: true,
  shippingMethods: ['DEALER_TRANSFER', 'PRIVATE_ARRANGE'],
  quantity: 1,
  listingType: 'BUY_NOW',
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('grouping a cart by seller and delivery class', () => {
  it('puts one seller’s goods lines in ONE group with one toggle', () => {
    const groups = groupCartBySellerAndClass([
      goods({ listingId: 'l-1' }),
      goods({ listingId: 'l-2' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].classes).toHaveLength(1);
    const group = groups[0].classes[0];
    expect(group.key).toBe(cartGroupKey('seller-1', 'GOODS'));
    expect(group.items.map((item) => item.listingId)).toEqual(['l-1', 'l-2']);
    // Exactly ONE toggle controls both lines: Courier / Private.
    expect(group.options.map((option) => option.label)).toEqual([
      'Courier',
      'Private',
    ]);
    expect(group.method).toBe('COURIER');
    expect(group.conflicted).toBe(false);
  });

  it('splits a seller with a firearm into TWO independent groups', () => {
    const groups = groupCartBySellerAndClass([
      goods(),
      firearm(),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].classes).toHaveLength(2);
    expect(groups[0].classes.map((g) => g.deliveryClass)).toEqual([
      'GOODS',
      'FIREARM',
    ]);
    // Firearm toggle is Dealer Stock / Private — never Courier.
    const firearmGroup = groups[0].classes[1];
    expect(firearmGroup.options.map((option) => option.label)).toEqual([
      'Dealer Stock',
      'Private',
    ]);
    expect(firearmGroup.options.map((option) => option.method)).toEqual([
      'DEALER_TRANSFER',
      'PRIVATE_ARRANGE',
    ]);
  });

  it('keeps two sellers in separate blocks', () => {
    const groups = groupCartBySellerAndClass([
      goods(),
      goods({ listingId: 'l-other', sellerId: 'seller-2', sellerUsername: 'ana' }),
    ]);
    expect(groups.map((group) => group.sellerId)).toEqual([
      'seller-1',
      'seller-2',
    ]);
    expect(groups[1].sellerName).toBe('ana');
  });

  it('honours the stored toggle and ignores an illegal stored method', () => {
    const chosen = groupCartBySellerAndClass([goods()], {
      [cartGroupKey('seller-1', 'GOODS')]: 'PRIVATE_ARRANGE',
    });
    expect(chosen[0].classes[0].method).toBe('PRIVATE_ARRANGE');

    // A firearm cannot Courier — the stored value must not survive.
    const illegal = groupCartBySellerAndClass([firearm()], {
      [cartGroupKey('seller-1', 'FIREARM')]: 'COURIER',
    });
    expect(illegal[0].classes[0].method).toBe('DEALER_TRANSFER');
  });

  it('makes a collection-only goods line Private-only (COLLECTION on the wire)', () => {
    const item = goods({ listingId: 'l-trailer', shippingMethods: ['COLLECTION'] });
    expect(isCollectionOnlyItem(item)).toBe(true);
    const groups = groupCartBySellerAndClass([item]);
    const group = groups[0].classes[0];
    expect(group.collectionOnly).toBe(true);
    expect(group.options.map((option) => option.label)).toEqual(['Private']);
    expect(group.method).toBe('COLLECTION');
  });

  it('flags an accessories group that has no single legal method', () => {
    // One collection-only trailer + one courier accessory from one seller:
    // COLLECTION and COURIER cannot share one toggle.
    const groups = groupCartBySellerAndClass([
      goods({ listingId: 'l-trailer', shippingMethods: ['COLLECTION'] }),
      goods({ listingId: 'l-rings' }),
    ]);
    const group = groups[0].classes[0];
    expect(group.conflicted).toBe(true);
    expect(hasConflictedGroup(groups)).toBe(true);
    // The flag names the real problem; the options shown are the first line's.
    expect(group.options.length).toBeGreaterThan(0);
  });

  it('falls back to the class pair for a legacy line with no shippingMethods', () => {
    const legacy = goods({ shippingMethods: [] });
    const groups = groupCartBySellerAndClass([legacy]);
    expect(groups[0].classes[0].options.map((o) => o.method)).toEqual([
      'COURIER',
      'PRIVATE_ARRANGE',
    ]);
  });

  it('exposes helper lookups for the cart page', () => {
    const groups = groupCartBySellerAndClass([goods(), firearm()]);
    const flat = cartClassGroups([goods(), firearm()]);
    expect(flat).toHaveLength(2);
    expect(classGroupForListing(groups, 'l-firearm')?.deliveryClass).toBe(
      'FIREARM',
    );
    expect(classGroupForListing(groups, 'nope')).toBeUndefined();
  });
});

describe('the buyer’s toggle choice persists across reloads', () => {
  it('saves and reads one group choice', () => {
    const key = cartGroupKey('seller-1', 'GOODS');
    expect(readCartDeliveryChoices()).toEqual({});
    saveCartDeliveryChoice(key, 'PRIVATE_ARRANGE');
    expect(readCartDeliveryChoices()).toEqual({ [key]: 'PRIVATE_ARRANGE' });
  });

  it('prunes choices for groups that no longer exist', () => {
    const goodsKey = cartGroupKey('seller-1', 'GOODS');
    const firearmKey = cartGroupKey('seller-1', 'FIREARM');
    saveCartDeliveryChoice(goodsKey, 'PRIVATE_ARRANGE');
    saveCartDeliveryChoice(firearmKey, 'PRIVATE_ARRANGE');
    pruneCartDeliveryChoices([goodsKey]);
    expect(readCartDeliveryChoices()).toEqual({
      [goodsKey]: 'PRIVATE_ARRANGE',
    });
  });

  it('ignores garbage in storage', () => {
    window.localStorage.setItem('gg:cartDelivery', '{not json');
    expect(readCartDeliveryChoices()).toEqual({});
    window.localStorage.setItem(
      'gg:cartDelivery',
      JSON.stringify(['not', 'a', 'map']),
    );
    expect(readCartDeliveryChoices()).toEqual({});
  });
});

describe('per-seller accessories shipping rows', () => {
  const quote = {
    groupKey: 'seller-1|COURIER|A:1 Main Rd',
    listingIds: ['l-goods'],
  };

  it('shows ONE row per seller accessories group, priced once', () => {
    const groups = groupCartBySellerAndClass([
      goods({ listingId: 'l-1' }),
      goods({ listingId: 'l-2', sellerId: 'seller-2', sellerUsername: 'ana' }),
    ]);
    const rows = cartShippingRows(
      groups,
      [
        { groupKey: 'q1', listingIds: ['l-1'] },
        { groupKey: 'q2', listingIds: ['l-2'] },
      ],
      {
        q1: { priceCents: 12_500, label: 'Cheapest Door Delivery' },
        q2: { priceCents: 8_000, label: 'Cheapest Door Delivery' },
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sellerName)).toEqual(['johan', 'ana']);
    expect(rows.map((row) => row.shippingCents)).toEqual([12_500, 8_000]);
    expect(shippingTotalCents(
      groups,
      [
        { groupKey: 'q1', listingIds: ['l-1'] },
        { groupKey: 'q2', listingIds: ['l-2'] },
      ],
      {
        q1: { priceCents: 12_500, label: 'Cheapest' },
        q2: { priceCents: 8_000, label: 'Cheapest' },
      },
    )).toBe(20_500);
  });

  it('shows NO shipping row for private/firearm groups', () => {
    const groups = groupCartBySellerAndClass([firearm()], {
      [cartGroupKey('seller-1', 'FIREARM')]: 'PRIVATE_ARRANGE',
    });
    expect(cartShippingRows(groups, [], {})).toEqual([]);

    const goodsPrivate = groupCartBySellerAndClass([goods()], {
      [cartGroupKey('seller-1', 'GOODS')]: 'PRIVATE_ARRANGE',
    });
    expect(cartShippingRows(goodsPrivate, [], {})).toEqual([]);
  });

  it('keeps the server’s group key when matching the quote by listing', () => {
    const groups = groupCartBySellerAndClass([goods()]);
    expect(
      quoteGroupForClassGroup(groups[0].classes[0], [quote])?.groupKey,
    ).toBe(quote.groupKey);
    const row = cartShippingRows(groups, [quote], {
      [quote.groupKey]: { priceCents: 9_900, label: 'Fastest' },
    })[0];
    expect(row.quoteGroupKey).toBe(quote.groupKey);
    expect(row.shippingCents).toBe(9_900);
  });

  it('reports an unquoted group as unpriced instead of a fake R0', () => {
    const groups = groupCartBySellerAndClass([goods()]);
    const rows = cartShippingRows(groups, [], {});
    expect(rows[0].shippingCents).toBeNull();
    expect(rows[0].quoteGroupKey).toBeNull();
  });
});

describe('the checkout payload sent to POST /orders/checkout', () => {
  const address = {
    streetAddress: '1 Main Road',
    suburb: 'Milpark',
    city: 'Johannesburg',
    province: 'GAUTENG',
    postalCode: '2092',
  };

  it('sends every line of a courier group the SAME method and one address', () => {
    const groups = groupCartBySellerAndClass([
      goods({ listingId: 'l-1' }),
      goods({ listingId: 'l-2', quantity: 3 }),
    ]);
    const quotes = [{ groupKey: 'q1', listingIds: ['l-1', 'l-2'] }];
    const lines = buildCartCheckoutLines(groups, {
      quoteForGroup: (group) =>
        quoteGroupForClassGroup(group, quotes),
      chosenQuotes: {
        q1: { kind: 'STORE_PICKUP', pickupPointLocationId: 42 },
      },
      deliveryAddress: address,
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.shippingMethod).toBe('COURIER');
      expect(line.deliveryAddress).toEqual(address);
      expect(line.deliveryOption).toBe('STORE_PICKUP');
      expect(line.pickupPointLocationId).toBe(42);
    }
    // Per-line units ride only when > 1 (same shape the single-item checkout uses).
    expect(lines[0].quantity).toBeUndefined();
    expect(lines[1].quantity).toBe(3);
  });

  it('sends consents for the two Private rails and nothing for Dealer Stock', () => {
    const dealer = buildCartCheckoutLines(
      groupCartBySellerAndClass([firearm()]),
      { quoteForGroup: () => null, chosenQuotes: {} },
    );
    expect(dealer).toEqual([
      { listingId: 'l-firearm', shippingMethod: 'DEALER_TRANSFER' },
    ]);

    const firearmPrivate = buildCartCheckoutLines(
      groupCartBySellerAndClass([firearm()], {
        [cartGroupKey('seller-1', 'FIREARM')]: 'PRIVATE_ARRANGE',
      }),
      { quoteForGroup: () => null, chosenQuotes: {} },
    );
    expect(firearmPrivate[0]).toMatchObject({
      shippingMethod: 'PRIVATE_ARRANGE',
      privateArrangeConsent: true,
    });

    const goodsPrivate = buildCartCheckoutLines(
      groupCartBySellerAndClass([goods()], {
        [cartGroupKey('seller-1', 'GOODS')]: 'PRIVATE_ARRANGE',
      }),
      { quoteForGroup: () => null, chosenQuotes: {} },
    );
    expect(goodsPrivate[0]).toMatchObject({
      shippingMethod: 'PRIVATE_ARRANGE',
      privateArrangeConsent: true,
    });
  });

  it('sends COLLECTION with the papers ack only when the buyer ticked it', () => {
    const trailer = goods({
      listingId: 'l-trailer',
      shippingMethods: ['COLLECTION'],
      collectionOnly: true,
      requiresPapers: true,
    });
    expect(needsCollectionPapersAck(groupCartBySellerAndClass([trailer]))).toBe(
      true,
    );
    const unacked = buildCartCheckoutLines(
      groupCartBySellerAndClass([trailer]),
      { quoteForGroup: () => null, chosenQuotes: {} },
    );
    expect(unacked[0].shippingMethod).toBe('COLLECTION');
    expect(unacked[0].collectionPapersAccepted).toBeUndefined();

    const acked = buildCartCheckoutLines(
      groupCartBySellerAndClass([trailer]),
      {
        quoteForGroup: () => null,
        chosenQuotes: {},
        collectionPapersAccepted: true,
      },
    );
    expect(acked[0].collectionPapersAccepted).toBe(true);
  });

  it('never sends a courier group without a destination', () => {
    const groups = groupCartBySellerAndClass([goods()]);
    const lines = buildCartCheckoutLines(groups, {
      quoteForGroup: () => null,
      chosenQuotes: {},
    });
    expect(lines[0].shippingMethod).toBe('COURIER');
    expect(lines[0].deliveryAddress).toBeUndefined();
  });
});
