// TransactionsService transitively imports ESM-only meilisearch; stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { TransactionsService } from '../payments/transactions.service';

// Build a TransactionsService with the minimal mocks the order-checkout /
// order-confirm paths touch. Positional ctor args mirror the existing
// cancel-by-buyer spec: prisma, fees, notifications, stitch, kyc, shipping,
// tracking, tokens, referenceNumbers, fraudRisk, cloudinary.
function makeService(over: {
  $transaction?: jest.Mock;
  orderFindUnique?: jest.Mock;
} = {}) {
  const txcMock = {
    order: { create: jest.fn().mockResolvedValue({ id: 'O1' }) },
    transaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction:
      over.$transaction ??
      jest.fn(async (fn: (txc: typeof txcMock) => unknown) => fn(txcMock)),
    listing: { update: jest.fn().mockResolvedValue({}) },
    transaction: {
      delete: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findUnique: over.orderFindUnique ?? jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    orderConfirmedBuyerMulti: jest.fn().mockResolvedValue(undefined),
  };
  const referenceNumbers = {
    allocateOrderReference: jest.fn().mockResolvedValue('GG-ORD-0001'),
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
    referenceNumbers as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, notifications, referenceNumbers, txcMock };
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
    commissionZar: 1_000,
    processingFee: 150,
    buyerTotal: 15_000,
    sellerPayout: 9_000,
    ...over,
  };
}

const lineDto = (id: string) => ({ listingId: id, shippingMethod: 'PUDO' as const, pudoPickupLockerId: 'LCK' });

describe('TransactionsService.createOrderCheckout', () => {
  it('creates an order from a single-seller cart and sums the totals', async () => {
    const { service, referenceNumbers, txcMock } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1 }) as never)
      .mockResolvedValueOnce(core({ n: 2 }) as never);

    const res = await service.createOrderCheckout(
      'clerk_B',
      { lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    expect(referenceNumbers.allocateOrderReference).toHaveBeenCalledTimes(1);
    expect(res.manual).toBe(true);
    expect(res.orderReference).toBe('GG-ORD-0001');
    expect(res.itemCount).toBe(2);
    // 2 lines × buyerTotal 15 000 = 30 000 cents
    expect(res.amountCents).toBe(30_000);
    expect(res.breakdown.buyerTotal).toBe(30_000);
    expect(res.breakdown.listingPrice).toBe(20_000);
    expect(res.breakdown.shippingCost).toBe(10_000);
    // children linked to the order
    expect(txcMock.transaction.updateMany).toHaveBeenCalled();
  });

  it('rejects a multi-seller cart and unwinds every reserved line', async () => {
    const { service, prisma } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, sellerId: 'S1' }) as never)
      .mockResolvedValueOnce(core({ n: 2, sellerId: 'S2' }) as never);

    await expect(
      service.createOrderCheckout(
        'clerk_B',
        { lines: [lineDto('L1'), lineDto('L2')] },
        'https://x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // both reserved lines restocked + their txs deleted (compensation)
    expect(prisma.listing.update).toHaveBeenCalledTimes(2);
    expect(prisma.transaction.delete).toHaveBeenCalledTimes(2);
  });

  it('rejects a duplicate listing before reserving anything', async () => {
    const { service } = makeService();
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'clerk_B',
        { lines: [lineDto('L1'), lineDto('L1')] },
        'https://x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an empty cart', async () => {
    const { service } = makeService();
    await expect(
      service.createOrderCheckout('clerk_B', { lines: [] }, 'https://x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a firearm line and unwinds', async () => {
    const { service, prisma } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, isFirearm: true }) as never);
    await expect(
      service.createOrderCheckout('clerk_B', { lines: [lineDto('L1')] }, 'https://x'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.listing.update).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.delete).toHaveBeenCalledTimes(1);
  });
});

describe('TransactionsService.confirmManualOrder', () => {
  const paidOrder = () => ({
    id: 'O1',
    paidAt: null,
    orderReference: 'GG-ORD-0001',
    buyerTotal: 30_000,
    transactions: [
      { id: 'TX1', buyerTotal: 15_000 },
      { id: 'TX2', buyerTotal: 15_000 },
    ],
    buyer: { email: 'b@x.co', firstName: 'Bo', lastName: 'Z', phone: '+27' },
  });

  it('pre-claims, fans out, atomically rolls up PAID, sends ONE buyer confirmation', async () => {
    const { service, prisma, notifications } = makeService({
      orderFindUnique: jest.fn().mockResolvedValue(paidOrder()),
    });
    const confirmSpy = jest
      .spyOn(service, 'confirmManualPayment')
      .mockResolvedValue(undefined);

    await service.confirmManualOrder('O1');

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    // preclaim (manualDetectedAt) + paid-claim (PAID) = two atomic updateMany
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }),
    );
    expect(notifications.orderConfirmedBuyerMulti).toHaveBeenCalledTimes(1);
  });

  it('is idempotent once the order is paid (early return)', async () => {
    const { service, prisma, notifications } = makeService({
      orderFindUnique: jest.fn().mockResolvedValue({ ...paidOrder(), paidAt: new Date() }),
    });
    const confirmSpy = jest
      .spyOn(service, 'confirmManualPayment')
      .mockResolvedValue(undefined);

    await service.confirmManualOrder('O1');

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(notifications.orderConfirmedBuyerMulti).not.toHaveBeenCalled();
  });

  it('refuses when child totals do not sum to the order total', async () => {
    const { service } = makeService({
      orderFindUnique: jest
        .fn()
        .mockResolvedValue({ ...paidOrder(), buyerTotal: 99_999 }),
    });
    await expect(service.confirmManualOrder('O1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bails without paying when the pre-claim loses (order swept/paid concurrently)', async () => {
    const { service, prisma, notifications } = makeService({
      orderFindUnique: jest.fn().mockResolvedValue(paidOrder()),
    });
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 }); // preclaim loses
    const confirmSpy = jest
      .spyOn(service, 'confirmManualPayment')
      .mockResolvedValue(undefined);

    await service.confirmManualOrder('O1');

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(notifications.orderConfirmedBuyerMulti).not.toHaveBeenCalled();
  });

  it('alerts + rethrows on a partial fan-out, never rolling up to PAID', async () => {
    const { service, prisma } = makeService({
      orderFindUnique: jest.fn().mockResolvedValue(paidOrder()),
    });
    jest
      .spyOn(service, 'confirmManualPayment')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    await expect(service.confirmManualOrder('O1')).rejects.toThrow('boom');
    expect(prisma.adminAlert.create).toHaveBeenCalled();
    // preclaim ran (count 1), but PAID-claim must NOT (only 1 updateMany call)
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });
});
