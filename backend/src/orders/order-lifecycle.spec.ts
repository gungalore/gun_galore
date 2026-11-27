// TransactionsService transitively imports ESM-only meilisearch; stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from '../payments/transactions.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ORDER LIFECYCLE FOLLOW-UP (2026-11-27).
 *
 * Pins the three fixes the lead called out as must-fix:
 *   1. removing a line re-quotes the seller's remaining parcel — INCLUDING a
 *      group that is now a single parcel — and writes the new rate/key;
 *   2. a failed re-quote aborts the removal with no relist;
 *   3. expiry/cancel restock and never touch paid orders;
 *   4. syncOrderStatus advances the order inline (CAS, never throws).
 * ────────────────────────────────────────────────────────────────────────────
 */

type Quote = {
  priceCents: number;
  serviceCode: string;
  providerSlug?: string;
  serviceLevelCode?: string;
  deliveryOption?: string;
  pickupPointLocationId?: number;
};

function makeService(
  over: {
    order?: Record<string, unknown> | null;
    quote?: Quote | null;
    paidRace?: boolean;
    syncThrows?: boolean;
  } = {},
) {
  const txc = {
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },    orderLineItem: { delete: jest.fn().mockResolvedValue({}) },
    listing: { update: jest.fn().mockResolvedValue({}) },
    order: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg) ? [] : (arg as (t: typeof txc) => unknown)(txc),
    ),
    order: {
      findFirst: jest.fn().mockResolvedValue(over.order ?? null),
      findUnique: jest.fn().mockResolvedValue(
        over.paidRace
          ? { paidAt: new Date(), status: 'PAID' }
          : { paidAt: null, status: 'AWAITING_PAYMENT' },
      ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: over.paidRace ? 0 : 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    listing: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const shipping = {
    quoteCombined: jest.fn().mockResolvedValue(over.quote ?? null),
  };
  const service = new TransactionsService(
    prisma as never,
    {
      calculatePlatformFee: (base: number) =>
        Math.max(1_000, Math.round(base * 0.1)),
    } as never,
    { orderConfirmedBuyerMulti: jest.fn() } as never,
    {} as never,
    {} as never,
    shipping as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      createCommissionInvoice: jest.fn(),
      createBuyerInvoice: jest.fn(),
      createOrderBuyerInvoice: jest.fn(),
    } as never,
    { notifyItemSold: jest.fn() } as never,
    { build: jest.fn() } as never,
  );
  const gateway = jest
    .spyOn(
      service as unknown as {
        createGatewayCheckout: (...args: unknown[]) => unknown;
      },
      'createGatewayCheckout',
    )
    .mockResolvedValue({
      provider: 'OZOW',
      checkoutId: 'CHK-NEW',
      redirectUrl: 'https://pay/new',
      merchantReference: 'ORD-O1-nonce2',
    } as never);
  return { service, prisma, shipping, gateway, txc };
}

function txLine(
  n: number,
  over: {
    carrier?: boolean;
    sellerId?: string;
    shippingCost?: number;
    collection?: boolean;
    firearm?: boolean;
  } = {},
) {
  const id = `TX${n}`;
  return {
    id,
    transactionId: id,
    quantity: 1,
    paidAt: null,
    shipsWithId: over.carrier === false ? 'TX1' : null,
    shippingMethod: over.collection
      ? 'COLLECTION'
      : over.firearm
        ? 'DEALER_TRANSFER'
        : 'COURIER',
    deliveryAddress: {
      streetAddress: '1 Main Road',
      suburb: 'Bellville',
      city: 'Cape Town',
      postalCode: '7530',
      province: 'WESTERN_CAPE',
      lat: -33.9,
      lng: 18.4,
    },
    deliveryOption: 'DOOR_CHEAPEST',
    pickupPointLocationId: null,
    listingPrice: 10_000,
    shippingCost: over.shippingCost ?? (over.carrier === false ? 0 : 9_000),
    shippingHandlingCents: 0,
    sellerId: over.sellerId ?? 'S1',
    listing: {
      id: `L${n}`,
      sellerId: over.sellerId ?? 'S1',
      isFirearm: over.firearm ?? false,
      trackInventory: true,
      title: `Item ${n}`,
    },
  };
}

function orderWith(lines: ReturnType<typeof txLine>[]) {
  return {
    id: 'O1',
    buyerId: 'BUYER',
    paidAt: null,
    status: 'AWAITING_PAYMENT',
    paymentProvider: 'OZOW',
    lineItems: lines.map((t) => ({
      id: `LINE-${t.id}`,
      transactionId: t.id,
      quantity: t.quantity,
      listing: t.listing,
      transaction: t,
    })),
  };
}

describe('removeOrderLine — re-quote the remaining parcel', () => {
  it('a group that drops 2 → 1 pays the SOLO rate, not the old combined rate', async () => {
    const order = orderWith([txLine(1), txLine(2, { carrier: false })]);
    const { service, prisma, shipping, gateway, txc } = makeService({
      order,
      quote: {
        priceCents: 7_000,
        serviceCode: 'bobgo_solo',
        providerSlug: 'bobgo',
        serviceLevelCode: 'door',
      },
    });
    // Remaining child after the live updates (survivor re-priced solo).
    prisma.transaction.findMany.mockResolvedValueOnce([
      {
        id: 'TX2',
        listingPrice: 10_000,
        shippingCost: 7_000,
        shippingHandlingCents: 0,
      },
    ]);

    const result = await service.removeOrderLine(
      'O1',
      'TX1',
      'BUYER',
      'https://x',
    );

    // ONE quote, for the surviving line ALONE.
    expect(shipping.quoteCombined).toHaveBeenCalledTimes(1);
    expect(shipping.quoteCombined.mock.calls[0][0]).toEqual([
      { listingId: 'L2', quantity: 1 },
    ]);
    // Survivor now carries the solo rate + rate key, and no longer rides a
    // deleted carrier.
    const survivorUpdate = prisma.transaction.update.mock.calls.find(
      (call) => (call[0] as { where: { id: string } }).where.id === 'TX2',
    );
    expect(survivorUpdate?.[0]).toMatchObject({
      data: {
        shippingCost: 7_000,
        shippingServiceCode: 'bobgo_solo',
        shippingProviderSlug: 'bobgo',
        shippingServiceLevelCode: 'door',
        shipsWithId: null,
      },
    });
    // Old combined 9,000 is gone; new total is base 17,000 + 10% fee = 18,700.
    expect(result.cancelled).toBe(false);
    expect(result.amountCents).toBe(18_700);
    expect(gateway).toHaveBeenCalledWith(
      'OZOW',
      expect.objectContaining({
        amountZarCents: 18_700,
        merchantTransactionId: expect.stringMatching(/^ORD-O1-/),
      }),
    );
    // The removed line is restored immediately (stock + ACTIVE) and deleted.
    expect(txc.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(txc.transaction.deleteMany).toHaveBeenCalled();
  });

  it('promotes the survivor when the removed line WAS the carrier', async () => {
    const order = orderWith([txLine(2, { carrier: false }), txLine(1)]);
    const { service, prisma, txc } = makeService({
      order,
      quote: { priceCents: 7_000, serviceCode: 'bobgo_solo' },
    });
    prisma.transaction.findMany.mockResolvedValueOnce([
      {
        id: 'TX2',
        listingPrice: 10_000,
        shippingCost: 7_000,
        shippingHandlingCents: 0,
      },
    ]);

    await service.removeOrderLine('O1', 'TX1', 'BUYER', 'https://x');

    // Sibling links pointing at the deleted carrier are cleared first.
    expect(txc.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'O1', shipsWithId: 'TX1' },
        data: { shipsWithId: null },
      }),
    );
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX2' },
        data: expect.objectContaining({
          shippingCost: 7_000,
          shipsWithId: null,
        }),
      }),
    );
  });

  it('a failed re-quote aborts the whole removal with NO relist', async () => {
    const order = orderWith([txLine(1), txLine(2, { carrier: false })]);
    const { service, prisma } = makeService({ order, quote: null });

    await expect(
      service.removeOrderLine('O1', 'TX1', 'BUYER', 'https://x'),
    ).rejects.toThrow(/nothing has been removed/i);
    expect(prisma.listing.update).not.toHaveBeenCalled();
    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses a PAID order with a 409 before anything is touched', async () => {
    const order = { ...orderWith([txLine(1)]), paidAt: new Date(), status: 'PAID' };
    const { service, prisma } = makeService({ order });
    await expect(
      service.removeOrderLine('O1', 'TX1', 'BUYER', 'https://x'),
    ).rejects.toThrow(/already been paid/i);
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('removing the LAST line cancels the order and restocks it', async () => {
    const order = orderWith([txLine(1)]);
    const { service, prisma, txc } = makeService({ order, quote: null });
    const result = await service.removeOrderLine(
      'O1',
      'TX1',
      'BUYER',
      'https://x',
    );
    expect(result.cancelled).toBe(true);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'O1', paidAt: null, status: 'AWAITING_PAYMENT' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(txc.listing.update).toHaveBeenCalled();
  });

  it('stops if a capture lands between release and re-price', async () => {
    const order = orderWith([txLine(1), txLine(2, { carrier: false })]);
    const { service, prisma } = makeService({
      order,
      paidRace: true,
      quote: { priceCents: 7_000, serviceCode: 'bobgo_solo' },
    });
    await expect(
      service.removeOrderLine('O1', 'TX1', 'BUYER', 'https://x'),
    ).rejects.toThrow(/just been paid/i);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_LINE_REMOVED_AFTER_PAYMENT',
          urgent: true,
        }),
      }),
    );
  });
});

describe('syncOrderStatus — inline rollup, CAS, never throws', () => {
  function statusService() {
    const prisma = {
      order: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new TransactionsService(
      prisma as never,
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
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }
  const order = (status: string, children: string[]) => ({
    id: 'O1',
    status,
    transactions: children.map((paymentStatus) => ({ paymentStatus })),
  });

  it('PAID + all children released → COMPLETED', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PAID', ['RELEASED', 'RELEASED']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('COMPLETED');
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'O1', status: 'PAID' },
      data: { status: 'COMPLETED' },
    });
  });

  it('PAID + released/refunded mix → PARTIALLY_FULFILLED', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PAID', ['RELEASED', 'REFUNDED']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('PARTIALLY_FULFILLED');
  });

  it('PAID + all refunded → REFUNDED', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PAID', ['REFUNDED', 'REFUNDED']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('REFUNDED');
  });

  it('still in flight → unchanged, no write', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PAID', ['RELEASED', 'HELD']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('PAID');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('PARTIALLY_FULFILLED advances once its last line settles', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PARTIALLY_FULFILLED', ['RELEASED', 'RELEASED']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('COMPLETED');
  });

  it('unpaid order untouched', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('AWAITING_PAYMENT', ['HELD']),
    );
    expect(await service.syncOrderStatus('O1')).toBe('AWAITING_PAYMENT');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('loses a CAS race safely and never throws', async () => {
    const { service, prisma } = statusService();
    prisma.order.findUnique.mockResolvedValue(
      order('PAID', ['RELEASED', 'RELEASED']),
    );
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.syncOrderStatus('O1')).toBe('PAID');

    prisma.order.findUnique.mockRejectedValue(new Error('db down'));
    await expect(service.syncOrderStatus('O1')).resolves.toBeNull();
  });
});

describe('expireUnpaidOrders / cancelUnpaidOrder', () => {
  function lifecycleService() {
    const txc = {
      transaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderLineItem: { delete: jest.fn() },
      listing: { update: jest.fn().mockResolvedValue({}) },
      order: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (arg: unknown) =>
        Array.isArray(arg) ? [] : (arg as (t: typeof txc) => unknown)(txc),
      ),
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        delete: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      listing: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
      adminAlert: { create: jest.fn() },
    };
    const service = new TransactionsService(
      prisma as never,
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
      {} as never,
      {} as never,
    );
    return { service, prisma, txc };
  }

  it('cancels + restocks every stale unpaid order', async () => {
    const { service, prisma } = lifecycleService();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'O1',
        buyerId: 'BUYER',
        transactions: [
          {
            id: 'TX1',
            quantity: 2,
            listing: { id: 'L1', trackInventory: true, title: 'Item' },
          },
        ],
      },
    ]);
    const result = await service.expireUnpaidOrders();
    expect(result.cancelled).toBe(1);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'O1', paidAt: null, status: 'AWAITING_PAYMENT' },
      data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
    });
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          quantityAvailable: { increment: 2 },
        }),
      }),
    );
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
  });

  it('a paid order is never cancelled by the sweep (CAS loses)', async () => {
    const { service, prisma } = lifecycleService();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'O1',
        buyerId: 'BUYER',
        transactions: [
          {
            id: 'TX1',
            quantity: 1,
            listing: { id: 'L1', trackInventory: false, title: 'Item' },
          },
        ],
      },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.expireUnpaidOrders();
    expect(result.cancelled).toBe(0);
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('cancelUnpaidOrder claims the order then releases every line', async () => {
    const { service, prisma } = lifecycleService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'O1',
      buyerId: 'BUYER',
      status: 'AWAITING_PAYMENT',
      paidAt: null,
      transactions: [
        {
          id: 'TX1',
          quantity: 1,
          paidAt: null,
          listing: { id: 'L1', trackInventory: true },
        },
      ],
    });
    const result = await service.cancelUnpaidOrder('O1', 'BUYER');
    expect(result).toEqual({ cancelled: true, orderId: 'O1' });
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
      }),
    );
    expect(prisma.listing.update).toHaveBeenCalled();
  });

  it('cancelUnpaidOrder refuses a paid order', async () => {
    const { service, prisma } = lifecycleService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'O1',
      buyerId: 'BUYER',
      status: 'PAID',
      paidAt: new Date(),
      transactions: [
        {
          id: 'TX1',
          quantity: 1,
          paidAt: new Date(),
          listing: { id: 'L1', trackInventory: true },
        },
      ],
    });
    await expect(service.cancelUnpaidOrder('O1', 'BUYER')).rejects.toThrow(
      /already been paid/i,
    );
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });
});
