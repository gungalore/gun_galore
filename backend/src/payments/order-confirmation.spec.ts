// THE CART BUYER WHO WAS NEVER TOLD ANYTHING.
//
// Every line of a basket is its own Transaction, so the per-line "order
// confirmed" is deliberately suppressed for order children — the buyer made
// ONE payment and should get ONE confirmation. That suppression deferred to
// confirmManualOrder, which was DELETED with the manual-EFT rail, and its
// replacement (NotificationsService.orderConfirmedBuyerMulti) had no caller
// anywhere in production: its only reference was a jest mock for a service
// file that no longer exists. A multi-item cart buyer would therefore have
// received nothing at all, by either route, the day PAYMENTS_LIVE was
// switched on.
//
// maybeConfirmWholeOrder closes that. These tests hold it to the two things
// that matter: it fires only when the LAST line is paid, and it fires only
// ONCE even when several payment handlers race for that last line.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

type Line = { id: string; paidAt: Date | null; buyerTotal: number };

function makeService(over: {
  order?: Record<string, unknown> | null;
  lines?: Line[];
  /** Rows the CAS claim matched. 0 = another handler got there first. */
  claimCount?: number;
}) {
  const lines = over.lines ?? [
    { id: 'T1', paidAt: new Date(), buyerTotal: 51_197 },
    { id: 'T2', paidAt: new Date(), buyerTotal: 12_000 },
  ];

  const order =
    over.order === null
      ? null
      : {
          id: 'O1',
          orderReference: 'GG-ORD-000123',
          paidAt: null,
          buyer: {
            email: 'buyer@example.com',
            phone: '+27820000000',
            firstName: 'Thabo',
            lastName: 'Nkosi',
          },
          transactions: lines,
          ...(over.order ?? {}),
        };

  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: over.claimCount ?? 1 }),
    },
  };
  const notifications = {
    orderConfirmedBuyerMulti: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TransactionsService(
    prisma as never,
    {} as never, // fees
    notifications as never,
    {} as never, // peach
    {} as never, // kyc
    {} as never, // shipping
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );

  const run = (orderId = 'O1') =>
    (
      service as unknown as {
        maybeConfirmWholeOrder: (id: string) => Promise<void>;
      }
    ).maybeConfirmWholeOrder(orderId);

  return { run, prisma, notifications };
}

const sent = (h: ReturnType<typeof makeService>) =>
  h.notifications.orderConfirmedBuyerMulti;

describe('confirming a whole basket', () => {
  it('⚠️ confirms once every line is paid — the notification that never fired', () => {
    const h = makeService({});
    return h.run().then(() => {
      expect(sent(h)).toHaveBeenCalledTimes(1);
      const arg = sent(h).mock.calls[0][0];
      expect(arg.orderId).toBe('O1');
      expect(arg.orderReference).toBe('GG-ORD-000123');
      expect(arg.itemCount).toBe(2);
      expect(arg.buyerEmail).toBe('buyer@example.com');
    });
  });

  it('stays quiet while any line is still unpaid', async () => {
    const h = makeService({
      lines: [
        { id: 'T1', paidAt: new Date(), buyerTotal: 51_197 },
        { id: 'T2', paidAt: null, buyerTotal: 12_000 },
      ],
    });
    await h.run();
    expect(sent(h)).not.toHaveBeenCalled();
    expect(h.prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('⚠️ sends ONE email when two handlers race for the last line', async () => {
    // Peach's result page and its webhook both drive markPaid, and a
    // multi-seller cart pays several lines concurrently. Both callers can see
    // "all lines paid"; only the one that wins the CAS may notify. Without
    // this the buyer is emailed twice for one order.
    const winner = makeService({ claimCount: 1 });
    const loser = makeService({ claimCount: 0 });

    await Promise.all([winner.run(), loser.run()]);

    expect(sent(winner)).toHaveBeenCalledTimes(1);
    expect(sent(loser)).not.toHaveBeenCalled();
  });

  it('claims with a paidAt-null predicate, and marks the order PAID', async () => {
    const h = makeService({});
    await h.run();
    const call = h.prisma.order.updateMany.mock.calls[0][0];
    // The null predicate IS the lock — without it the claim is not atomic.
    expect(call.where).toEqual({ id: 'O1', paidAt: null });
    expect(call.data.status).toBe('PAID');
    expect(call.data.paidAt).toBeInstanceOf(Date);
  });

  it('never re-confirms an order already marked paid', async () => {
    const h = makeService({ order: { paidAt: new Date() } });
    await h.run();
    expect(sent(h)).not.toHaveBeenCalled();
    expect(h.prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('⚠️ totals what was actually PAID, not the order snapshot', async () => {
    // A line re-priced between reservation and payment (shipping re-quoted
    // against a new address) leaves Order.buyerTotal stale. The buyer's
    // confirmation must state the figure that left their account.
    const h = makeService({
      lines: [
        { id: 'T1', paidAt: new Date(), buyerTotal: 51_197 },
        { id: 'T2', paidAt: new Date(), buyerTotal: 12_000 },
        { id: 'T3', paidAt: new Date(), buyerTotal: 899 },
      ],
    });
    await h.run();
    expect(sent(h).mock.calls[0][0].buyerTotal).toBe(51_197 + 12_000 + 899);
    expect(sent(h).mock.calls[0][0].itemCount).toBe(3);
  });

  it('does not hold a basket open on an order with no lines left', async () => {
    // Defensive: an order whose every line was cancelled before payment has
    // nothing to confirm, and must not be reported as fully paid.
    const h = makeService({ lines: [] });
    await h.run();
    expect(sent(h)).not.toHaveBeenCalled();
    expect(h.prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to a readable reference when the order has none', async () => {
    const h = makeService({ order: { orderReference: null } });
    await h.run();
    expect(sent(h).mock.calls[0][0].orderReference).toBe('O1');
  });

  it('⚠️ never throws — the money is already committed', async () => {
    // This runs inside the post-payment notification block. A dead mail
    // provider must not turn a paid order into a failed request.
    const h = makeService({});
    sent(h).mockRejectedValue(new Error('resend is down'));
    await expect(h.run()).resolves.toBeUndefined();
  });

  it('survives the order having vanished', async () => {
    const h = makeService({ order: null });
    await expect(h.run()).resolves.toBeUndefined();
    expect(sent(h)).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// ⚠️ THE CALL SITE ITSELF — the gap the tests above could not see.
//
// Every test above invokes maybeConfirmWholeOrder directly through a cast, so
// they all passed while the call site sat BELOW an early return:
// sendSaleNotifications bails out for PRIVATE_ARRANGE, which is a legal cart
// line (a firearm line routes to PA), so whenever one was the LAST line paid
// the confirmer was never reached — Order stuck at AWAITING_PAYMENT (the
// rollup sweep only scans PAID) and no consolidated confirmation.
//
// These drive sendSaleNotifications for real and assert the order is still
// claimed. Testing a private method directly is what hid the defect; this is
// the shape that catches it.
// ────────────────────────────────────────────────────────────────────

function makeNotifyService(tx: Record<string, unknown>) {
  const prisma = {
    transaction: { findUnique: jest.fn().mockResolvedValue(tx) },
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'O1',
        orderReference: 'GG-ORD-000123',
        paidAt: null,
        buyer: { email: 'b@e.com', phone: null, firstName: 'T', lastName: 'N' },
        transactions: [{ id: 'T1', paidAt: new Date(), buyerTotal: 51_197 }],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const notifications = {
    orderConfirmedBuyerMulti: jest.fn().mockResolvedValue(undefined),
    orderConfirmedBuyer: jest.fn().mockResolvedValue(undefined),
    newSaleSeller: jest.fn().mockResolvedValue(undefined),
    privateArrangeContactReveal: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    notifications as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const run = () =>
    (
      service as unknown as {
        sendSaleNotifications: (id: string) => Promise<void>;
      }
    ).sendSaleNotifications('T1');
  return { run, prisma, notifications };
}

const CART_LINE = {
  id: 'T1',
  orderId: 'O1',
  listingId: 'L1',
  buyer: { email: 'b@e.com', phone: null, firstName: 'T', lastName: 'N' },
  seller: { email: 's@e.com', phone: null, firstName: 'S', lastName: 'L' },
  listingPrice: 51_197,
  commissionZar: 4_050,
  processingFee: 2_147,
  shippingCost: 0,
  shippingHandlingCents: 0,
  buyerTotal: 51_197,
  sellerPayout: 45_000,
  passFeeToBuyer: true,
  feeModel: 'BUYNOW_MARKUP',
  shippingMethod: 'PUDO',
  paidAt: new Date(),
};

describe('the confirmation is reachable on every cart line kind', () => {
  it('⚠️ claims the order even when the last line is PRIVATE_ARRANGE', async () => {
    const h = makeNotifyService({
      ...CART_LINE,
      shippingMethod: 'PRIVATE_ARRANGE',
      listing: { id: 'L1', title: 'Rifle', category: {} },
    });
    await h.run();
    expect(h.prisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(h.notifications.orderConfirmedBuyerMulti).toHaveBeenCalledTimes(1);
  });

  it('still claims it on an ordinary courier line', async () => {
    const h = makeNotifyService({
      ...CART_LINE,
      listing: { id: 'L1', title: 'Torch', category: {} },
    });
    await h.run();
    expect(h.prisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(h.notifications.orderConfirmedBuyerMulti).toHaveBeenCalledTimes(1);
  });
});
