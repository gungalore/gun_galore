import { describe, expect, it } from 'vitest';
import {
  orderListImageUrl,
  orderListNeedsPayment,
  orderListPreviewTitle,
  orderListReference,
  orderListSellerCount,
  orderListStatus,
  orderListTotalCents,
  orderListUnitCount,
  parseOrderList,
  type OrderListItem,
} from './order-list';

// /my/orders now lists ORDERS (one payment for the whole cart), not one row
// per child transaction. These are the words + numbers each row shows.
const item = (over: Partial<OrderListItem> = {}): OrderListItem => ({
  id: 'order-abcdef123456',
  status: 'AWAITING_PAYMENT',
  orderReference: 'AO-1042',
  itemsSubtotal: 30_000,
  shippingSubtotal: 10_000,
  processingFee: 4_000,
  buyerTotal: 44_000,
  createdAt: '2026-11-27T10:00:00.000Z',
  lineItems: [
    {
      listing: {
        id: 'l-1',
        title: 'Scope rings',
        images: [{ url: 'https://cdn.example/rings.jpg' }],
      },
      quantity: 2,
    },
    {
      listing: { id: 'l-2', title: 'Bipod', images: [] },
      quantity: 1,
    },
  ],
  ...over,
});

describe('a row in My Orders', () => {
  it('shows the order status, item count, total and reference', () => {
    const row = item();
    expect(orderListStatus(row).label).toBe('Awaiting payment');
    expect(orderListStatus({ ...row, status: 'PAID' }).label).toBe('Paid');
    expect(orderListUnitCount(row)).toBe(3);
    expect(orderListTotalCents(row)).toBe(44_000);
    expect(orderListReference(row)).toBe('AO-1042');
  });

  it('flags an order that still needs the buyer to pay', () => {
    expect(orderListNeedsPayment(item())).toBe(true);
    expect(orderListNeedsPayment(item({ status: 'PAID' }))).toBe(false);
    expect(orderListNeedsPayment(item({ status: 'PARTIALLY_FULFILLED' }))).toBe(
      false,
    );
  });

  it('previews the first line and counts the rest', () => {
    expect(orderListPreviewTitle(item())).toBe('Scope rings +1 more');
    expect(
      orderListPreviewTitle(
        item({ lineItems: [item().lineItems![0]] }),
      ),
    ).toBe('Scope rings');
    expect(orderListPreviewTitle(item({ lineItems: [] }))).toBe('Order');
  });

  it('uses the first available line image', () => {
    expect(orderListImageUrl(item())).toBe('https://cdn.example/rings.jpg');
    expect(
      orderListImageUrl(item({ lineItems: [{ listing: { title: 'x' } }] })),
    ).toBeNull();
  });

  it('counts distinct sellers for the “each seller ships separately” cue', () => {
    const row = item({
      lineItems: [
        { listing: { title: 'a' }, quantity: 1, sellerId: 's1' } as never,
        { listing: { title: 'b' }, quantity: 1, sellerId: 's2' } as never,
        { listing: { title: 'c' }, quantity: 1, sellerId: 's1' } as never,
      ],
    });
    expect(orderListSellerCount(row)).toBe(2);
  });

  it('falls back to the id tail when the reference is absent', () => {
    expect(
      orderListReference(item({ orderReference: null })),
    ).toBe('EF123456');
  });
});

describe('reading GET /orders defensively', () => {
  it('drops non-order rows and non-array bodies', () => {
    expect(parseOrderList(null)).toEqual([]);
    expect(parseOrderList({ message: 'nope' })).toEqual([]);
    expect(
      parseOrderList([
        { id: 'order-1' },
        { nope: true },
        null,
        'x',
        { id: 'order-2' },
      ]).map((row) => row.id),
    ).toEqual(['order-1', 'order-2']);
  });
});
