import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORDER_PAGE_SIZE,
  ORDER_SEGMENTS,
  fetchOrderBook,
  fetchOrderCard,
  orderPageWindow,
  parseOrderPage,
  parseOrderSegment,
  orderRowReference,
  orderStatusTone,
  orderSub,
  type OrderSegment,
  type OrderStatusKey,
} from './desk-orders';

/**
 * The order book's three dangerous jobs, tested because being wrong at any of
 * them costs somebody something real:
 *
 *   · WHAT GOES ON THE WIRE. `status` is passed straight into a typed Prisma
 *     `where`, so a segment key that is not one of the six enum values does
 *     not return a wrong list — it fails the query, and the operator reads
 *     that as "Orders is broken". And 'ALL' must send NO status at all rather
 *     than the string "ALL".
 *
 *   · WHAT THE PAGER CLAIMS. pageWindow's size argument defaults to
 *     PEOPLE_PAGE_SIZE (50) and this board pages at 20. A caller who forgets
 *     the argument gets a footer that says "51–100 of 84" over twenty rows,
 *     with nothing anywhere that looks wrong.
 *
 *   · WHAT THE ROW CARRIES. Both endpoints hand back the buyer's email, and
 *     the dossier hands back their phone. If either reaches an OrderRow or an
 *     OrderCard it reaches the board, and from there a shared screen. The
 *     mappers dropping them is a rule, so it gets a test rather than a
 *     comment — a type omission alone does not delete anything at runtime.
 */

const WIRE_ORDER = {
  id: 'ord_cuid_abcdefgh12345',
  orderReference: 'GG-ORD-0042',
  status: 'PAID',
  paymentMethod: 'MANUAL_EFT',
  buyerTotal: 1_248_000,
  paidAt: '2026-09-01T08:00:00.000Z',
  createdAt: '2026-08-31T18:22:00.000Z',
  // The wire really does carry this. Nothing may map it through.
  buyer: { id: 'usr_1', username: 'boetdiesel', email: 'someone@example.test' },
  _count: { transactions: 3 },
};

const WIRE_DOSSIER = {
  order: {
    id: 'ord_cuid_abcdefgh12345',
    orderReference: 'GG-ORD-0042',
    status: 'PAID',
    paymentMethod: 'MANUAL_EFT',
    itemsSubtotal: 1_200_000,
    shippingSubtotal: 30_000,
    handlingSubtotal: 8_000,
    processingFee: 10_000,
    buyerTotal: 1_248_000,
    manualPayByAt: '2026-09-02T08:00:00.000Z',
    manualDetectedAt: null,
    manualCancelledAt: null,
    paidAt: '2026-09-01T08:00:00.000Z',
    createdAt: '2026-08-31T18:22:00.000Z',
    updatedAt: '2026-09-01T08:01:00.000Z',
    // Both of these are on the wire, and neither may survive the mapper.
    buyer: {
      id: 'usr_1',
      username: 'boetdiesel',
      email: 'someone@example.test',
      phone: '+27821234567',
    },
    transactions: [
      {
        id: 'tx_first',
        paymentStatus: 'HELD',
        shippingMethod: 'COURIER',
        shippingStatus: 'BOOKED',
        shipsWithId: null,
        buyerTotal: 800_000,
        sellerPayout: 760_000,
        refundedAmount: 0,
        listing: { id: 'l1', title: 'CZ 457', referenceNumber: 'LS0042' },
        seller: { id: 'usr_2', username: 'raakskiet' },
      },
      { id: 'tx_second', paymentStatus: 'HELD', buyerTotal: 448_000 },
    ],
  },
};

// Typed with fetch's own signature so `spy.mock.calls[0][0]` is the URL rather
// than an index into an empty tuple — which is what a bare `vi.fn(async () =>
// …)` infers, and it fails the typecheck rather than the test.
function stubFetch(payload: unknown) {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The query string the board actually asked for. */
function queryOf(spy: ReturnType<typeof stubFetch>): URLSearchParams {
  const url = String(spy.mock.calls[0][0]);
  return new URLSearchParams(url.slice(url.indexOf('?')));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ORDER_SEGMENTS', () => {
  /**
   * ⚠️ THE EXHAUSTIVE MAP IS THE TEST. Adding a seventh value to prisma's
   * OrderStatus without adding its chip would leave orders sitting in a state
   * no filter on this board can reach, and nothing would look broken — the
   * All list would just quietly contain rows the six chips cannot isolate.
   * Typing the fixture as Record<OrderStatusKey, true> makes that a compile
   * error; comparing it to the array makes it a test failure too.
   */
  const EVERY_STATUS: Record<OrderStatusKey, true> = {
    AWAITING_PAYMENT: true,
    PAID: true,
    PARTIALLY_FULFILLED: true,
    COMPLETED: true,
    CANCELLED: true,
    REFUNDED: true,
  };

  it('has a chip for every OrderStatus, exactly once, plus All', () => {
    const keys = ORDER_SEGMENTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('ALL');
    expect([...keys].slice(1).sort()).toEqual(Object.keys(EVERY_STATUS).sort());
  });

  it('gives every segment a label, and never falls back to the raw key', () => {
    for (const s of ORDER_SEGMENTS) {
      expect(s.label).not.toBe(s.key);
      expect(s.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('fetchOrderBook — what goes on the wire', () => {
  it("🚨 'ALL' sends NO status — the string ALL is not an OrderStatus", async () => {
    const spy = stubFetch({ orders: [], total: 0, page: 1, limit: 20 });
    await fetchOrderBook('ALL', 1);

    const q = queryOf(spy);
    expect(q.has('status')).toBe(false);
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
  });

  it('sends the enum value verbatim, with the page and our own limit', async () => {
    const spy = stubFetch({ orders: [], total: 0, page: 2, limit: 20 });
    await fetchOrderBook('PARTIALLY_FULFILLED', 2);

    const q = queryOf(spy);
    expect(q.get('status')).toBe('PARTIALLY_FULFILLED');
    expect(q.get('page')).toBe('2');
    expect(q.get('limit')).toBe(String(ORDER_PAGE_SIZE));
    expect(String(spy.mock.calls[0][0])).toContain('/admin/orders?');
  });

  it('every segment key round-trips as a status the backend accepts', async () => {
    for (const s of ORDER_SEGMENTS) {
      const spy = stubFetch({ orders: [], total: 0, page: 1, limit: 20 });
      await fetchOrderBook(s.key, 1);
      const status = queryOf(spy).get('status');
      expect(status).toBe(s.key === 'ALL' ? null : s.key);
      vi.unstubAllGlobals();
    }
  });

  it('clamps a page of 0 or -3 to 1 — skip: -20 would be a Prisma error', async () => {
    for (const bad of [0, -3, 0.4]) {
      const spy = stubFetch({ orders: [], total: 0, page: 1, limit: 20 });
      await fetchOrderBook('PAID', bad as number);
      expect(queryOf(spy).get('page')).toBe('1');
      vi.unstubAllGlobals();
    }
  });
});

describe('fetchOrderBook — what the row carries', () => {
  it('🚨 drops buyer.email: it is on the wire and never on the row', async () => {
    stubFetch({ orders: [WIRE_ORDER], total: 1, page: 1, limit: 20 });
    const page = await fetchOrderBook('ALL', 1);

    const row = page.orders[0];
    expect(Object.keys(row.buyer).sort()).toEqual(['id', 'username']);
    expect('email' in row.buyer).toBe(false);
    // The whole page, not just the one field we thought to check.
    expect(JSON.stringify(page)).not.toContain('someone@example.test');
  });

  it('keeps every field the board actually renders', async () => {
    stubFetch({ orders: [WIRE_ORDER], total: 1, page: 1, limit: 20 });
    const page = await fetchOrderBook('ALL', 1);

    expect(page.orders[0]).toMatchObject({
      id: 'ord_cuid_abcdefgh12345',
      orderReference: 'GG-ORD-0042',
      status: 'PAID',
      paymentMethod: 'MANUAL_EFT',
      buyerTotal: 1_248_000,
      createdAt: '2026-08-31T18:22:00.000Z',
      buyer: { id: 'usr_1', username: 'boetdiesel' },
      _count: { transactions: 3 },
    });
    expect(page.total).toBe(1);
  });
});

describe('fetchOrderCard', () => {
  it('🚨 drops buyer entirely — email AND phone, and the whole party with them', async () => {
    stubFetch(WIRE_DOSSIER);
    const card = await fetchOrderCard('ord_cuid_abcdefgh12345');

    expect('buyer' in card).toBe(false);
    const serialised = JSON.stringify(card);
    expect(serialised).not.toContain('someone@example.test');
    expect(serialised).not.toContain('+27821234567');
    // The per-line seller and payout are not this surface's either — they are
    // visible one line at a time, in the drawer's own money section.
    expect(serialised).not.toContain('raakskiet');
    expect(serialised).not.toContain('760000');
  });

  it('carries the five money columns as recorded, and adds nothing up', async () => {
    stubFetch(WIRE_DOSSIER);
    const card = await fetchOrderCard('ord_cuid_abcdefgh12345');

    expect(card.itemsSubtotal).toBe(1_200_000);
    expect(card.shippingSubtotal).toBe(30_000);
    expect(card.handlingSubtotal).toBe(8_000);
    expect(card.processingFee).toBe(10_000);
    // Straight off the column — NOT the sum of the four above it.
    expect(card.buyerTotal).toBe(1_248_000);
  });

  it('names the FIRST line as the one the drawer opens', async () => {
    stubFetch(WIRE_DOSSIER);
    const card = await fetchOrderCard('ord_cuid_abcdefgh12345');

    expect(card.firstTransactionId).toBe('tx_first');
    expect(card.lineCount).toBe(2);
  });

  it('⚠️ an order with no lines yields null, not a crash and not a guess', async () => {
    stubFetch({ order: { ...WIRE_DOSSIER.order, transactions: [] } });
    const card = await fetchOrderCard('ord_empty');

    expect(card.firstTransactionId).toBeNull();
    expect(card.lineCount).toBe(0);
  });

  it('encodes the id, so a slash in one cannot walk the path', async () => {
    const spy = stubFetch(WIRE_DOSSIER);
    await fetchOrderCard('a/b');
    expect(String(spy.mock.calls[0][0])).toContain('/admin/orders/a%2Fb/dossier');
  });
});

describe('orderPageWindow', () => {
  /**
   * ⚠️ THE REGRESSION TEST FOR PEOPLE'S 50. 41 rows at 20 a page means page 3
   * holds exactly one row and is the last one. At People's default size the
   * same call says the window starts at row 101 of a 41-row list and there is
   * a previous page — a footer that is wrong in three places at once.
   */
  it('pages at 20, not at People’s 50', () => {
    expect(orderPageWindow(41, 3)).toEqual({
      first: 41,
      last: 41,
      hasPrev: true,
      hasNext: false,
      beyondEnd: false,
    });
  });

  it('states an empty list as 0, never as row 1 of nothing', () => {
    expect(orderPageWindow(0, 1)).toEqual({
      first: 0,
      last: 0,
      hasPrev: false,
      hasNext: false,
      beyondEnd: false,
    });
  });

  it('opens on 1–20 of 1,204 and knows there is more', () => {
    expect(orderPageWindow(1204, 1)).toEqual({
      first: 1,
      last: 20,
      hasPrev: false,
      hasNext: true,
      beyondEnd: false,
    });
  });

  /**
   * 🚨 THE BACKWARDS RANGE. Page 4 of a 50-row list used to compute
   * first = 61, last = 50 — and the pager printed "61–50 of 50" underneath a
   * table that was simultaneously saying it had nothing on it. No adversary is
   * needed to reach it: a bookmark carrying ?page=4 does, and so does a list
   * that shrinks between loads while somebody is reading it.
   *
   * hasPrev MUST stay true. It is the only way back to a page that exists.
   */
  it('reports past-the-end rather than counting backwards', () => {
    expect(orderPageWindow(50, 4)).toEqual({
      first: 0,
      last: 0,
      hasPrev: true,
      hasNext: false,
      beyondEnd: true,
    });
  });

  it('never lets first exceed last, at any page of any total', () => {
    for (const total of [0, 1, 19, 20, 21, 50, 1204]) {
      for (const page of [1, 2, 3, 4, 61, 999]) {
        const w = orderPageWindow(total, page);
        expect(w.last).toBeGreaterThanOrEqual(w.first);
      }
    }
  });

  it('holds the last real page rather than calling it past the end', () => {
    // 50 rows at 20 a page: page 3 is real and holds rows 41–50.
    expect(orderPageWindow(50, 3)).toEqual({
      first: 41,
      last: 50,
      hasPrev: true,
      hasNext: false,
      beyondEnd: false,
    });
  });

  it('closes exactly on the boundary — 20 of 20 has no next page', () => {
    expect(orderPageWindow(20, 1)).toEqual({
      first: 1,
      last: 20,
      hasPrev: false,
      hasNext: false,
      beyondEnd: false,
    });
  });
});

describe('orderSub', () => {
  it('says "1 paid order", not "1 paid orders"', () => {
    expect(orderSub(1, 'PAID')).toBe('1 paid order');
  });

  it('names the segment when one is chosen', () => {
    expect(orderSub(312, 'AWAITING_PAYMENT')).toBe('312 awaiting payment orders');
  });

  it('says nothing about a segment on All', () => {
    expect(orderSub(1204, 'ALL')).toBe('1204 orders');
    expect(orderSub(0, 'ALL')).toBe('0 orders');
  });
});

describe('orderStatusTone', () => {
  it('⚠️ REFUNDED is warn, never bad — a refund is an action, not a fault', () => {
    expect(orderStatusTone('REFUNDED')).toBe('warn');
  });

  it('never spends bad-red on this board: Order has no dispute status', () => {
    const statuses: OrderStatusKey[] = [
      'AWAITING_PAYMENT',
      'PAID',
      'PARTIALLY_FULFILLED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ];
    for (const s of statuses) expect(orderStatusTone(s)).not.toBe('bad');
  });

  it('tones the states the operator scans for', () => {
    expect(orderStatusTone('AWAITING_PAYMENT')).toBe('warn');
    expect(orderStatusTone('COMPLETED')).toBe('ok');
    expect(orderStatusTone('CANCELLED')).toBe('neutral');
    expect(orderStatusTone('PAID')).toBe('info');
  });
});

describe('parseOrderSegment — the URL is untrusted input', () => {
  it('accepts every real segment key verbatim', () => {
    for (const s of ORDER_SEGMENTS) expect(parseOrderSegment(s.key)).toBe(s.key);
  });

  it('🚨 refuses anything else, so junk never reaches a Prisma where', () => {
    for (const junk of ['paid', 'DROP TABLE', 'sellers', '', 'ALL_ORDERS', null, undefined]) {
      expect(parseOrderSegment(junk)).toBe('ALL');
    }
  });

  it('and what it returns is always something fetchOrderBook can send', async () => {
    const spy = stubFetch({ orders: [], total: 0, page: 1, limit: 20 });
    await fetchOrderBook(parseOrderSegment('nonsense'), 1);
    expect(queryOf(spy).has('status')).toBe(false);
  });
});

describe('parseOrderPage', () => {
  it('reads a real page number', () => {
    expect(parseOrderPage('3')).toBe(3);
  });

  it('lands on page 1 for junk, zero, negatives and absence', () => {
    for (const junk of ['0', '-2', 'abc', '', null, undefined, 'NaN']) {
      expect(parseOrderPage(junk)).toBe(1);
    }
  });
});

describe('orderRowReference', () => {
  it('prints the order number when there is one', () => {
    expect(orderRowReference({ id: 'ord_abcdefgh', orderReference: 'GG-ORD-0042' })).toBe(
      'GG-ORD-0042',
    );
  });

  it('⚠️ marks an id fragment as one, so nobody pastes it into a search', () => {
    expect(orderRowReference({ id: 'ord_abcdefgh1234', orderReference: null })).toBe('ord_abcd…');
  });
});

/** A compile-time assertion, not a runtime one: every key is a real segment. */
const SEGMENT_KEYS: OrderSegment[] = ORDER_SEGMENTS.map((s) => s.key);
void SEGMENT_KEYS;
