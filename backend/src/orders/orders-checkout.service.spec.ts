// TransactionsService transitively imports ESM-only meilisearch; stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
/**
 * The order checkout now creates ONE gateway capture for the whole cart
 * (multi-item checkout, 2026-11-27). The payment-mode module is evaluated at
 * import time, so it is stubbed here to put the cart behind a live rail without
 * touching process-wide env in a unit spec.
 */
jest.mock('../payments/payment-mode', () => ({
  PAYMENT_MODE: 'paygate',
  PAYMENTS_LIVE: true,
  assertPaymentsLive: () => undefined,
  assertCartCheckoutLive: () => undefined,
}));

import { BadRequestException } from '@nestjs/common';
import { TransactionsService } from '../payments/transactions.service';

// Build a TransactionsService with the minimal mocks the order-checkout path
// touches. Positional ctor args mirror the existing cancel-by-buyer spec.
function makeService(
  over: {
    combinedQuote?: {
      priceCents: number;
      serviceCode: string;
      providerSlug?: string;
      serviceLevelCode?: string;
      deliveryOption?: string;
      pickupPointLocationId?: number;
    } | null;
    firearmIds?: string[];
    sellerFor?: (id: string) => string;
    gatewayFails?: boolean;
    deleteCount?: number;
    persistFails?: boolean;
    orderPaidState?: { paidAt: Date | null; status: string } | null;
  } = {},
) {
  const txcMock = {
    order: {
      create: jest.fn().mockResolvedValue({ id: 'O1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderLineItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // A consolidated cart needs a combined quote; tests that exercise the
  // "cannot re-price the group" refusal pass `combinedQuote: null`.
  const combinedQuote =
    over.combinedQuote === undefined
      ? { priceCents: 9_000, serviceCode: 'bobgo_door' }
      : over.combinedQuote;
  const shipping = {
    quoteCombined: jest.fn().mockResolvedValue(combinedQuote),
  };
  const sellerFor = over.sellerFor ?? (() => 'S1');
  const prisma = {
    $transaction: jest.fn(async (fn: (txc: typeof txcMock) => unknown) => {
      if (Array.isArray(fn)) return [];
      return fn(txcMock);
    }),
    listing: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in.map((id: string) => ({
              id,
              listingType: 'BUY_NOW',
              isFirearm: over.firearmIds?.includes(id) ?? false,
              sellerId: sellerFor(id),
              collectionOnly: false,
              title: `Item ${id}`,
              shippingMethods: ['COURIER'],
            })),
          ),
      ),
    },
    transaction: {
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    order: {
      findUnique:
        over.orderPaidState !== undefined
          ? jest.fn().mockResolvedValue(over.orderPaidState)
          : jest.fn(),
      findFirst: jest.fn(),
      update: over.persistFails
        ? jest.fn().mockRejectedValue(new Error('db write failed'))
        : jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest
        .fn()
        .mockResolvedValue({ count: over.deleteCount ?? 1 }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    orderConfirmedBuyerMulti: jest.fn().mockResolvedValue(undefined),
    ratingReceived: jest.fn(),
  };
  const service = new TransactionsService(
    prisma as never,
    {
      calculatePlatformFee: (base: number) => {
        // Mirrors the real bands closely enough for the totals assertions:
        // 10% of the first R25,000, 9% of the next R25,000, R10 floor.
        if (base === 0) return 0;
        const first = Math.min(base, 2_500_000);
        const second = Math.min(Math.max(0, base - 2_500_000), 2_500_000);
        return Math.max(1_000, Math.round(first * 0.1 + second * 0.09));
      },
    } as never,
    notifications as never,
    {} as never,
    {} as never, // kyc
    shipping as never, // shipping
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never,
    {} as never,
    {
      createCommissionInvoice: jest.fn().mockResolvedValue(undefined),
      createBuyerInvoice: jest.fn().mockResolvedValue(undefined),
      createOrderBuyerInvoice: jest.fn().mockResolvedValue(undefined),
    } as never, // zohoBooks
    { notifyItemSold: jest.fn().mockResolvedValue(undefined) } as never,
    { build: jest.fn().mockResolvedValue(Buffer.from('')) } as never,
  );
  const gateway = jest
    .spyOn(
      service as unknown as {
        createGatewayCheckout: (...args: unknown[]) => unknown;
      },
      'createGatewayCheckout',
    )
    .mockImplementation(async () => {
      if (over.gatewayFails) throw new Error('gateway down');
      return {
        provider: 'OZOW',
        checkoutId: 'CHK1',
        redirectUrl: 'https://gateway.example/pay/CHK1',
        merchantReference: 'ORD-O1',
      } as never;
    });
  return { service, prisma, notifications, txcMock, shipping, gateway };
}

// A fake shared-core result for one line.
function core(over: Record<string, unknown> = {}) {
  return {
    tx: { id: 'TX' + Math.round(Number(over.n ?? 1)), buyerId: 'BUYER' },
    listing: {
      id: 'L' + Math.round(Number(over.n ?? 1)),
      sellerId: (over.sellerId as string) ?? 'S1',
      isFirearm: (over.isFirearm as boolean) ?? false,
      listingType: 'BUY_NOW',
      price: 10_000,
      trackInventory: false,
    },
    offerRecord: null,
    buyer: { id: 'BUYER' },
    quantity: 1,
    listingPrice: 10_000,
    shippingCost: 5_000,
    shippingHandlingCents: 0,
    commissionZar: 1_000,
    processingFee: 150,
    buyerTotal: 15_000,
    sellerPayout: 9_000,
    ...over,
  };
}

const lineDto = (id: string) => ({
  listingId: id,
  shippingMethod: 'COURIER' as const,
});

describe('TransactionsService.createOrderCheckout', () => {
  it('creates one order, allocates ONE platform fee, and mints one gateway capture', async () => {
    const { service, txcMock, gateway } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1 }) as never)
      .mockResolvedValueOnce(core({ n: 2 }) as never);

    const res = await service.createOrderCheckout(
      'user_B',
      { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    // bases 15,000 + 15,000 = 30,000; ONE fee 10% = 3,000.
    expect(res.itemCount).toBe(2);
    expect(res.amountCents).toBe(33_000);
    expect(res.breakdown).toMatchObject({
      listingPrice: 20_000,
      shippingCost: 10_000,
      processingFee: 3_000,
      buyerTotal: 33_000,
    });
    // ONE capture for the ORDER, with a unique per-attempt ORD- reference.
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(gateway).toHaveBeenCalledWith(
      'OZOW',
      expect.objectContaining({
        amountZarCents: 33_000,
        merchantTransactionId: expect.stringMatching(/^ORD-O1-/),
        returnUrl: 'https://x/checkout/complete?orderId=O1',
      }),
    );
    expect(res).toMatchObject({
      orderId: 'O1',
      paymentId: 'CHK1',
      redirectUrl: 'https://gateway.example/pay/CHK1',
      provider: 'ozow',
    });
    // children linked to the order; gateway fields persisted on it.
    expect(txcMock.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['TX1', 'TX2'] } },
        data: { orderId: 'O1' },
      }),
    );
  });

  it('accepts a MULTI-seller cart: one order fans out per seller, no unwind', async () => {
    const { service, prisma } = makeService({
      sellerFor: (id) => (id === 'L2' ? 'S2' : 'S1'),
    });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, sellerId: 'S1' }) as never)
      .mockResolvedValueOnce(core({ n: 2, sellerId: 'S2' }) as never);

    const res = await service.createOrderCheckout(
      'user_B',
      { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    expect(res.itemCount).toBe(2);
    expect(res.amountCents).toBe(33_000);
    expect(prisma.listing.update).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it('P6.2 — consolidates a same-seller courier group: one combined quote + shipsWith on the sibling', async () => {
    const { service, shipping, txcMock } = makeService({
      combinedQuote: { priceCents: 6_000, serviceCode: 'bobgo_door' },
    });
    const spy = jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, sellerId: 'S1' }) as never)
      .mockResolvedValueOnce(core({ n: 2, sellerId: 'S1' }) as never);

    await service.createOrderCheckout(
      'user_B',
      { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    // ONE combined quote for the 2-line group.
    expect(shipping.quoteCombined).toHaveBeenCalledTimes(1);
    // Carrier (first line, TX1) charged the combined cost; sibling (TX2) = 0.
    const overrides = spy.mock.calls.map(
      (call) => (call as unknown[])[2] as { costCents: number },
    );
    expect(overrides.map((o) => o.costCents)).toEqual([6_000, 0]);
    // The sibling tx is linked to the carrier's shipment.
    expect(txcMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX2' },
        data: { shipsWithId: 'TX1' },
      }),
    );
  });

  it('refuses with "buy separately" when the combined quote cannot be priced', async () => {
    const { service } = makeService({ combinedQuote: null });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValue(core({ n: 1, sellerId: 'S1' }) as never);
    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L2')] },
        'https://x',
      ),
    ).rejects.toThrow(/buy them separately/i);
  });

  it('rejects an auction/offer line before reserving anything (cart = BUY_NOW only)', async () => {
    const { service, prisma } = makeService();
    prisma.listing.findMany.mockResolvedValueOnce([
      { id: 'L1', listingType: 'AUCTION' },
    ]);
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toThrow(/auctions, swaps and offer items/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a duplicate listing before reserving anything', async () => {
    const { service } = makeService();
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an empty cart', async () => {
    const { service } = makeService();
    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [] },
        'https://x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('P6-A — ACCEPTS a firearm line in the cart and NEVER consolidates it', async () => {
    const { service, shipping } = makeService({ firearmIds: ['L1'] });
    const spy = jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(
        core({
          n: 1,
          isFirearm: true,
          shippingCost: 0,
          shippingHandlingCents: 0,
          buyerTotal: 10_000,
        }) as never,
      )
      .mockResolvedValueOnce(
        core({ n: 2, shippingHandlingCents: 1_500, buyerTotal: 16_500 }) as never,
      );

    const res = await service.createOrderCheckout(
      'user_B',
      {
        buyerTermsAccepted: true,
        lines: [
          {
            listingId: 'L1',
            shippingMethod: 'DEALER_TRANSFER',
            firearmAttestation18Plus: true,
          },
          lineDto('L2'),
        ],
      },
      'https://x',
    );

    expect(res.itemCount).toBe(2);
    // Firearm excluded from grouping: the one courier line is a solo group.
    expect(shipping.quoteCombined).not.toHaveBeenCalled();
    // bases 10,000 + 16,500 = 26,500; fee 2,650 → total 29,150.
    expect(res.breakdown).toMatchObject({
      shippingHandlingCents: 1_500,
      processingFee: 2_650,
      buyerTotal: 29_150,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('one fee on the aggregate, not one per line (the P6.4 two-line cart)', async () => {
    const { service } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(
        core({ n: 1, shippingHandlingCents: 1_500, buyerTotal: 16_500 }) as never,
      )
      .mockResolvedValueOnce(
        core({ n: 2, shippingHandlingCents: 1_500, buyerTotal: 16_500 }) as never,
      );

    const res = await service.createOrderCheckout(
      'user_B',
      { buyerTermsAccepted: true, lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    // base = 2 × (10,000 + 5,000 + 1,500) = 33,000; fee = 3,300.
    expect(res.breakdown.shippingHandlingCents).toBe(3_000);
    expect(res.breakdown.shippingCost).toBe(10_000);
    expect(res.breakdown.processingFee).toBe(3_300);
    expect(res.breakdown.buyerTotal).toBe(36_300);
  });

  it('unwinds every reservation when the gateway checkout cannot be created (unpaid order)', async () => {
    const { service, prisma } = makeService({ gatewayFails: true });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValue(core({ n: 1 }) as never);

    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toThrow(/payment processing failed/i);
    // The unpaid order row is deleted and the line released.
    expect(prisma.order.deleteMany).toHaveBeenCalledWith({
      where: { id: 'O1', paidAt: null },
    });
    expect(prisma.listing.update).toHaveBeenCalled();
    expect(prisma.transaction.delete).toHaveBeenCalled();
    // The branch already unwound — the outer catch must not touch anything else.
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('⚠️ NEVER unwinds children when the order was captured before the gateway threw', async () => {
    const { service, prisma } = makeService({
      gatewayFails: true,
      deleteCount: 0, // the conditional order delete lost the race: paid
      orderPaidState: { paidAt: new Date(), status: 'PAID' },
    });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValue(core({ n: 1 }) as never);

    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toThrow(/could not finish setting up payment/i);

    // The paid order keeps its children and the listings keep their stock —
    // deleting either would destroy a paid sale.
    expect(prisma.listing.update).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_CREATE_FAILED_AFTER_PAYMENT',
          urgent: true,
        }),
      }),
    );
  });

  it('releases the order line items + cancels the order before unwinding an unpaid post-create failure', async () => {
    // Gateway call succeeds but persisting its fields fails: the outer catch is
    // the only cleanup. The order must be unlinked/cancelled BEFORE the child
    // deletes, or the OrderLineItem FK blocks the unwind.
    const { service, prisma, txcMock } = makeService({
      persistFails: true,
      orderPaidState: { paidAt: null, status: 'AWAITING_PAYMENT' },
    });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValue(core({ n: 1 }) as never);

    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toThrow(/could not finish setting up payment/i);

    expect(txcMock.orderLineItem.deleteMany).toHaveBeenCalledWith({
      where: { orderId: 'O1' },
    });
    expect(txcMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'O1', paidAt: null },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    // Then the reservations are released — no orphan left for the sweep. The
    // paid-order alert must NOT fire (the existing gateway-persist alert is
    // expected for this failure).
    expect(prisma.listing.update).toHaveBeenCalled();
    expect(prisma.transaction.delete).toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_CREATE_FAILED_AFTER_PAYMENT',
        }),
      }),
    );
  });

  it('⚠️ alerts instead of unwinding when a post-create failure finds the order already paid', async () => {
    const { service, prisma, txcMock } = makeService({
      persistFails: true,
      orderPaidState: { paidAt: new Date(), status: 'PAID' },
    });
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValue(core({ n: 1 }) as never);

    await expect(
      service.createOrderCheckout(
        'user_B',
        { buyerTermsAccepted: true, lines: [lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toThrow();

    expect(txcMock.orderLineItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_CREATE_FAILED_AFTER_PAYMENT',
          urgent: true,
        }),
      }),
    );
  });

  it('rejects YOCO (the motivation paygate rail) before reserving', async () => {
    const { service } = makeService();
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'user_B',
        {
          buyerTermsAccepted: true,
          paymentProvider: 'YOCO' as never,
          lines: [lineDto('L1')],
        },
        'https://x',
      ),
    ).rejects.toThrow(/not available/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives a mixed goods+firearm seller TWO independent delivery choices', async () => {
    // Same seller: the accessories are collected in person, the firearm goes to
    // a dealer. Different delivery CLASSES, so the two methods are independent
    // — they must not be conflated into one "seller method".
    const { service, shipping } = makeService({ firearmIds: ['L1'] });
    const spy = jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(
        core({
          n: 1,
          isFirearm: true,
          shippingCost: 0,
          buyerTotal: 10_000,
        }) as never,
      )
      .mockResolvedValueOnce(
        core({ n: 2, shippingCost: 0, buyerTotal: 10_000 }) as never,
      );

    const res = await service.createOrderCheckout(
      'user_B',
      {
        buyerTermsAccepted: true,
        lines: [
          {
            listingId: 'L1',
            shippingMethod: 'DEALER_TRANSFER',
            firearmAttestation18Plus: true,
          },
          { listingId: 'L2', shippingMethod: 'COLLECTION' },
        ],
      },
      'https://x',
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(shipping.quoteCombined).not.toHaveBeenCalled();
    expect(res.itemCount).toBe(2);
  });

  it('refuses a GOODS group that mixes COLLECTION and COURIER with an actionable error', async () => {
    const { service } = makeService();
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'user_B',
        {
          buyerTermsAccepted: true,
          lines: [
            { listingId: 'L1', shippingMethod: 'COURIER' },
            { listingId: 'L2', shippingMethod: 'COLLECTION' },
          ],
        },
        'https://x',
      ),
    ).rejects.toThrow(/same delivery method/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
