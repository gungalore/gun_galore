import { describe, expect, it } from 'vitest';
import {
  cartItemsFromOrder,
  orderItemCount,
  orderLineDeliveryClass,
  orderLineDeliveryText,
  orderLineListingId,
  orderLineShippingStatus,
  orderReference,
  orderSellerGroups,
  orderShippingRowTotal,
  orderShippingRows,
  orderTotals,
  type OrderDetail,
  type OrderLineItem,
} from './order-page';

// ─────────────────────────────────────────────────────────────────────
// /orders/[id]'s pure half. The approved order page must show:
//   • seller-grouped lines, each with its delivery class/method;
//   • ONE shipping row per seller accessories group;
//   • totals with the ONE aggregated Platform Fee;
//   • partial/complete status on a paid order, and no removal once paid.
// The cleanup/sync path (remove a line → sync the cart to the returned
// order) is asserted here too.
// ─────────────────────────────────────────────────────────────────────

const line = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  id: 'line-1',
  listingId: 'l-1',
  sellerId: 'seller-1',
  seller: { id: 'seller-1', username: 'johan' },
  deliveryClass: 'GOODS',
  quantity: 1,
  unitPrice: 10_000,
  lineSubtotal: 10_000,
  listing: {
    id: 'l-1',
    title: 'Scope rings',
    images: [{ url: 'https://cdn.example/rings.jpg' }],
  },
  transaction: {
    id: 'tx-1',
    paymentStatus: 'HELD',
    shippingStatus: 'PENDING',
    shippingMethod: 'COURIER',
  },
  ...over,
});

const order = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  id: 'order-abcdef123456',
  status: 'AWAITING_PAYMENT',
  orderReference: 'AO-1042',
  itemsSubtotal: 10_000,
  shippingSubtotal: 12_500,
  handlingSubtotal: 0,
  processingFee: platformFee(),
  buyerTotal: 10_000 + 12_500 + platformFee(),
  paidAt: null,
  createdAt: '2026-11-27T10:00:00.000Z',
  lineItems: [line()],
  shippingGroups: [
    {
      key: 'seller-1|COURIER|A:1 Main Road',
      sellerId: 'seller-1',
      sellerUsername: 'johan',
      class: 'GOODS',
      transactionId: 'tx-1',
      method: 'COURIER',
      shippingCents: 12_500,
    },
  ],
  canRemove: true,
  ...over,
});

/** platformFeeCents(22_500) — imported lazily to keep this fixture readable. */
function platformFee(): number {
  // 22,500c base → 10% band = 2,250c, above the R10 floor.
  return 2_250;
}

describe('grouping order lines by seller and delivery class', () => {
  it('splits one seller into an accessories block and a firearms block', () => {
    const groups = orderSellerGroups(
      order({
        lineItems: [
          line({ id: 'line-1', listingId: 'l-1' }),
          line({
            id: 'line-2',
            listingId: 'l-2',
            deliveryClass: 'FIREARM',
            listing: { id: 'l-2', title: '9mm pistol' },
            transaction: {
              id: 'tx-2',
              paymentStatus: 'HELD',
              shippingStatus: null,
              shippingMethod: 'DEALER_TRANSFER',
            },
          }),
        ],
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sellerName).toBe('johan');
    expect(groups[0].goods.map((item) => item.id)).toEqual(['line-1']);
    expect(groups[0].firearms.map((item) => item.id)).toEqual(['line-2']);
  });

  it('keeps two sellers in separate blocks with their own shipping rows', () => {
    const groups = orderSellerGroups(
      order({
        lineItems: [
          line({ id: 'line-1' }),
          line({
            id: 'line-2',
            listingId: 'l-9',
            sellerId: 'seller-2',
            seller: { id: 'seller-2', username: 'ana' },
            listing: { id: 'l-9', title: 'Bipod' },
            transaction: {
              id: 'tx-9',
              paymentStatus: 'HELD',
              shippingStatus: 'PENDING',
              shippingMethod: 'COURIER',
            },
          }),
        ],
        shippingGroups: [
          {
            key: 'q-1',
            sellerId: 'seller-1',
            sellerUsername: 'johan',
            class: 'GOODS',
            transactionId: 'tx-1',
            method: 'COURIER',
            shippingCents: 12_500,
          },
          {
            key: 'q-2',
            sellerId: 'seller-2',
            sellerUsername: 'ana',
            class: 'GOODS',
            transactionId: 'tx-9',
            method: 'COURIER',
            shippingCents: 8_000,
          },
        ],
      }),
    );
    expect(groups.map((group) => group.sellerId)).toEqual([
      'seller-1',
      'seller-2',
    ]);
    expect(groups[1].shipping[0].shippingCents).toBe(8_000);
  });

  it('reads an old payload: seller via transaction, class via shipping method', () => {
    const groups = orderSellerGroups(
      order({
        sellers: [
          {
            sellerId: 'seller-7',
            username: 'legacy-seller',
            transactionId: 'tx-old',
            canRate: true,
            rating: null,
          },
        ],
        lineItems: [
          line({
            sellerId: undefined,
            seller: undefined,
            deliveryClass: undefined,
            transaction: {
              id: 'tx-old',
              paymentStatus: 'HELD',
              shippingStatus: null,
              shippingMethod: 'DEALER_TRANSFER',
            },
          }),
        ],
        shippingGroups: null,
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].sellerId).toBe('seller-7');
    expect(groups[0].sellerName).toBe('legacy-seller');
    expect(groups[0].firearms).toHaveLength(1);
    expect(groups[0].goods).toHaveLength(0);
  });
});

describe('delivery words per line', () => {
  it('reads the class from the payload, else the shipping method', () => {
    expect(orderLineDeliveryClass(line())).toBe('GOODS');
    expect(
      orderLineDeliveryClass(
        line({
          deliveryClass: undefined,
          transaction: {
            id: 'tx',
            paymentStatus: 'HELD',
            shippingStatus: null,
            shippingMethod: 'DEALER_TRANSFER',
          },
        }),
      ),
    ).toBe('FIREARM');
  });

  it('prints the shared labels + courier progress only', () => {
    expect(orderLineDeliveryText(line())).toBe('Courier · Awaiting dispatch');
    expect(orderLineShippingStatus(line())).toBe('Awaiting dispatch');

    const privateArrange = line({
      transaction: {
        id: 'tx',
        paymentStatus: 'HELD',
        shippingStatus: 'PENDING',
        shippingMethod: 'PRIVATE_ARRANGE',
      },
    });
    expect(orderLineDeliveryText(privateArrange)).toBe('Private');
    expect(orderLineShippingStatus(privateArrange)).toBeNull();

    const dealer = line({
      deliveryClass: 'FIREARM',
      transaction: {
        id: 'tx',
        paymentStatus: 'HELD',
        shippingStatus: null,
        shippingMethod: 'DEALER_TRANSFER',
      },
    });
    expect(orderLineDeliveryText(dealer)).toBe('Dealer Stock');
  });

  it('reads the listing id from the scalar or the joined row', () => {
    expect(orderLineListingId(line())).toBe('l-1');
    expect(orderLineListingId(line({ listingId: undefined }))).toBe('l-1');
  });
});

describe('one shipping row per seller accessories group', () => {
  it('uses the server’s shippingGroups and never a row for a R0 hand-over', () => {
    const rows = orderShippingRows(
      order({
        shippingGroups: [
          {
            key: 'q-1',
            sellerId: 'seller-1',
            sellerUsername: 'johan',
            class: 'GOODS',
            transactionId: 'tx-1',
            method: 'COURIER',
            shippingCents: 12_500,
          },
          {
            key: 'q-2',
            sellerId: 'seller-1',
            sellerUsername: 'johan',
            class: 'FIREARM',
            transactionId: 'tx-2',
            method: 'DEALER_TRANSFER',
            shippingCents: 0,
          },
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sellerName: 'johan',
      label: 'Courier',
      shippingCents: 12_500,
    });
  });

  it('falls back to ONE honest Delivery total on a pre-shippingGroups payload', () => {
    const rows = orderShippingRows(
      order({ shippingGroups: null, shippingSubtotal: 9_500, handlingSubtotal: 500 }),
    );
    expect(rows).toEqual([
      {
        key: 'legacy-delivery',
        sellerId: null,
        sellerName: '',
        label: 'Delivery',
        shippingCents: 10_000,
      },
    ]);
  });

  it('has no delivery row when nothing shipped', () => {
    expect(
      orderShippingRows(
        order({ shippingGroups: [], shippingSubtotal: 0, handlingSubtotal: 0 }),
      ),
    ).toEqual([]);
  });

  it('the rows foot to the order’s shipping column', () => {
    const detail = order({
      shippingGroups: [
        {
          key: 'q-1',
          sellerId: 'seller-1',
          sellerUsername: 'johan',
          class: 'GOODS',
          transactionId: 'tx-1',
          method: 'COURIER',
          shippingCents: 12_500,
        },
      ],
    });
    expect(orderShippingRowTotal(detail)).toBe(detail.shippingSubtotal);
  });
});

describe('order totals include the ONE aggregated platform fee', () => {
  it('uses the recorded processingFee and foots', () => {
    const detail = order();
    const totals = orderTotals(detail);
    expect(totals.platformFeeCents).toBe(detail.processingFee);
    expect(
      totals.itemsCents + totals.shippingCents + totals.platformFeeCents,
    ).toBe(totals.totalCents);
    expect(totals.totalCents).toBe(detail.buyerTotal);
  });

  it('folds the legacy handlingSubtotal into Delivery', () => {
    const totals = orderTotals(
      order({ shippingSubtotal: 5_000, handlingSubtotal: 500 }),
    );
    expect(totals.shippingCents).toBe(5_500);
  });

  it('derives the fee from the column identity when processingFee is absent', () => {
    const detail = order({ processingFee: undefined });
    // buyerTotal - items - shipping = the fee that was actually charged.
    const totals = orderTotals(detail);
    expect(totals.platformFeeCents).toBe(2_250);
    expect(totals.totalCents).toBe(detail.buyerTotal);
  });
});

describe('order counts + reference', () => {
  it('counts units, not lines', () => {
    expect(
      orderItemCount({ lineItems: [line(), line({ quantity: 3 })] }),
    ).toBe(4);
  });

  it('uses the reference, else the id tail', () => {
    expect(orderReference({ id: 'x', orderReference: 'AO-1' })).toBe('AO-1');
    expect(orderReference({ id: 'order-abcdef123456', orderReference: null })).toBe(
      'EF123456',
    );
  });
});

describe('syncing the cart to the order the backend returned', () => {
  it('maps each remaining order line back onto its cart line', () => {
    const previousCart = [
      {
        listingId: 'l-1',
        title: 'Scope rings',
        price: 10_000,
        sellerId: 'seller-1',
        sellerUsername: 'johan',
        isFirearm: false,
        shippingMethods: ['COURIER', 'PRIVATE_ARRANGE'],
        quantity: 1,
        listingType: 'BUY_NOW',
        requiresPapers: true,
      },
    ];
    const items = cartItemsFromOrder(
      order({
        lineItems: [
          line({ quantity: 2, unitPrice: 10_000, lineSubtotal: 20_000 }),
        ],
      }),
      previousCart,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      listingId: 'l-1',
      title: 'Scope rings',
      price: 10_000,
      imageUrl: 'https://cdn.example/rings.jpg',
      sellerId: 'seller-1',
      sellerUsername: 'johan',
      isFirearm: false,
      shippingMethods: ['COURIER', 'PRIVATE_ARRANGE'],
      quantity: 2,
      listingType: 'BUY_NOW',
      requiresPapers: true,
    });
  });

  it('clears the cart when the order has no lines left', () => {
    expect(cartItemsFromOrder(order({ lineItems: [] }), [])).toEqual([]);
  });

  it('keeps a firearm a firearm with a dealer/private fallback pair', () => {
    const items = cartItemsFromOrder(
      order({
        lineItems: [
          line({
            id: 'line-2',
            listingId: 'l-2',
            deliveryClass: 'FIREARM',
            seller: { id: 'seller-1', username: 'johan' },
            listing: { id: 'l-2', title: '9mm pistol', images: null },
            transaction: {
              id: 'tx-2',
              paymentStatus: 'HELD',
              shippingStatus: null,
              shippingMethod: 'DEALER_TRANSFER',
            },
          }),
        ],
      }),
      [],
    );
    expect(items[0].isFirearm).toBe(true);
    expect(items[0].shippingMethods).toEqual([
      'DEALER_TRANSFER',
      'PRIVATE_ARRANGE',
    ]);
  });
});
