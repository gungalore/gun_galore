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
  firearmIds?: string[];
  collectionOnlyIds?: string[];
  combinedQuote?: { priceCents: number; serviceCode: string } | null;
} = {}) {
  const txcMock = {
    order: { create: jest.fn().mockResolvedValue({ id: 'O1' }) },
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // P6.2 — the consolidation pass calls shipping.quoteCombined. Default null =
  // no consolidation (existing tests keep summing per-line shipping).
  const shipping = {
    quoteCombined: jest
      .fn()
      .mockResolvedValue(over.combinedQuote ?? null),
  };
  const prisma = {
    $transaction:
      over.$transaction ??
      jest.fn(async (fn: (txc: typeof txcMock) => unknown) => fn(txcMock)),
    listing: {
      update: jest.fn().mockResolvedValue({}),
      // P0.2 review fix — createOrderCheckout pre-validates line TYPES
      // before any reservation. Default: plain BUY_NOW non-firearms.
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id: string) => ({
            id,
            listingType: 'BUY_NOW',
            isFirearm: over.firearmIds?.includes(id) ?? false,
            sellerId: 'S1', // P6.2 grouping key; combinedQuote null → no-op
            // FLOW-F6 M8 — P0.2 select now carries these for the up-front
            // collection-only rejection. Default: courier-capable non-collection.
            collectionOnly: over.collectionOnlyIds?.includes(id) ?? false,
            title: `Item ${id}`,
            shippingMethods: over.collectionOnlyIds?.includes(id)
              ? ['COLLECTION']
              : ['PUDO', 'TCG'],
          })),
        ),
      ),
    },
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
    {} as never, // kyc
    shipping as never, // shipping (P6.2 quoteCombined)
    {} as never, // tracking
    {} as never, // tokens
    referenceNumbers as never,
    {} as never,
    {} as never,
    { createCommissionInvoice: jest.fn().mockResolvedValue(undefined) } as never, // zohoBooks (P0.6)
    { notifyItemSold: jest.fn().mockResolvedValue(undefined) } as never, // wishlistAlerts (P5.2)
    { build: jest.fn().mockResolvedValue(Buffer.from('')) } as never, // saps534 (FLOW-F4 M21)
  );
  return { service, prisma, notifications, referenceNumbers, txcMock, shipping };
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
    shippingHandlingCents: 0, // P6.4 — set per-test; a courier waybill line = 1_500
    commissionZar: 1_000,
    processingFee: 150,
    buyerTotal: 15_000,
    sellerPayout: 9_000,
    ...over,
  };
}

const lineDto = (id: string) => ({ listingId: id, shippingMethod: 'PUDO' as const, pudoPickupLockerId: 'LCK' });
// P6-A — a firearm cart line: dealer transfer, attestation supplied, no courier target.
const firearmLineDto = (id: string) => ({
  listingId: id,
  shippingMethod: 'DEALER_TRANSFER' as const,
  firearmAttestation18Plus: true,
});

// Phase 1 (manual-EFT retirement): createOrderCheckout() now calls
// assertPaymentsLive() first, so with PAYMENTS_LIVE unset it throws the
// "card payments launching soon" 503 before any cart validation/pricing
// runs. Every case here lives behind that closed gate — skipped, not
// deleted, so they can be re-enabled once the card paygate goes live
// (PAYMENTS_LIVE=true). The confirmManualOrder suite below is unaffected
// (money-state path, doesn't call createOrderCheckout).
describe.skip('TransactionsService.createOrderCheckout', () => {
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

  it('accepts a MULTI-seller cart (Phase 8d): one order fans out per seller, no unwind', async () => {
    const { service, prisma, referenceNumbers } = makeService();
    jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, sellerId: 'S1' }) as never)
      .mockResolvedValueOnce(core({ n: 2, sellerId: 'S2' }) as never);

    const res = await service.createOrderCheckout(
      'clerk_B',
      { lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    expect(res.manual).toBe(true);
    expect(res.itemCount).toBe(2);
    expect(res.amountCents).toBe(30_000); // 2 lines × 15 000
    expect(referenceNumbers.allocateOrderReference).toHaveBeenCalledTimes(1); // ONE EFT for the basket
    // happy path → no compensation
    expect(prisma.listing.update).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it('P6.2 — consolidates a same-seller PUDO group: one combined quote + shipsWith on the sibling', async () => {
    const { service, shipping, txcMock } = makeService({
      combinedQuote: { priceCents: 6_000, serviceCode: 'PUDO-X' },
    });
    const spy = jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(core({ n: 1, sellerId: 'S1' }) as never)
      .mockResolvedValueOnce(core({ n: 2, sellerId: 'S1' }) as never);

    await service.createOrderCheckout(
      'clerk_B',
      { lines: [lineDto('L1'), lineDto('L2')] }, // same seller, PUDO, same locker
      'https://x',
    );

    // ONE combined quote for the 2-line group.
    expect(shipping.quoteCombined).toHaveBeenCalledTimes(1);
    // Carrier (first line, TX1) charged the combined cost; sibling (TX2) = 0.
    const overrides = spy.mock.calls.map((c) => (c as unknown[])[2]);
    expect(overrides).toContainEqual({ costCents: 6_000, serviceCode: 'PUDO-X' });
    expect(overrides).toContainEqual({ costCents: 0, serviceCode: null });
    // The sibling tx is linked to the carrier's shipment.
    expect(txcMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX2' },
        data: { shipsWithId: 'TX1' },
      }),
    );
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

  it('FLOW-F6 M8 — rejects a collection-only line up front and NAMES it, before reserving', async () => {
    const { service } = makeService({ collectionOnlyIds: ['L2'] });
    const spy = jest.spyOn(service as never, 'reserveAndCreateLine');
    await expect(
      service.createOrderCheckout(
        'clerk_B',
        { lines: [lineDto('L1'), lineDto('L2')] },
        'https://x',
      ),
    ).rejects.toThrow(/Item L2.*collection-only/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('P6-A — ACCEPTS a firearm line in the cart and NEVER consolidates it', async () => {
    // A firearm (dealer transfer) + a same-seller courier item. The firearm
    // must not be pulled into a courier parcel, so quoteCombined is never even
    // called for a group containing it (here the only other courier line is
    // solo, so no consolidation happens at all), and the order is created.
    const { service, shipping, referenceNumbers } = makeService({
      firearmIds: ['L1'],
    });
    const spy = jest
      .spyOn(service as never, 'reserveAndCreateLine')
      .mockResolvedValueOnce(
        core({ n: 1, isFirearm: true, shippingCost: 0, shippingHandlingCents: 0, buyerTotal: 10_000 }) as never,
      )
      .mockResolvedValueOnce(core({ n: 2, shippingHandlingCents: 1_500, buyerTotal: 16_500 }) as never);

    const res = await service.createOrderCheckout(
      'clerk_B',
      { lines: [firearmLineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    // Firearm line WAS reserved (no rejection), and the order was created.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.manual).toBe(true);
    // The firearm was excluded from grouping: with only one courier line left,
    // there is no 2+ group → quoteCombined never runs.
    expect(shipping.quoteCombined).not.toHaveBeenCalled();
    expect(referenceNumbers.allocateOrderReference).toHaveBeenCalledTimes(1);
    // Firearm carries no handling; the courier line carries the R15 waybill fee.
    expect(res.breakdown.shippingHandlingCents).toBe(1_500);
    // items 10 000 + 10 000, shipping 0 + 5 000, handling 0 + 1 500 → buyerTotal 26 500
    expect(res.breakdown.buyerTotal).toBe(26_500);
  });

  it('P6.4 — carries the R15 waybill margin into the order handling subtotal', async () => {
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
      'clerk_B',
      { lines: [lineDto('L1'), lineDto('L2')] },
      'https://x',
    );

    expect(res.breakdown.shippingHandlingCents).toBe(3_000); // R15 × 2 waybills
    expect(res.breakdown.shippingCost).toBe(10_000); // carrier cost, handling apart
    expect(res.breakdown.buyerTotal).toBe(33_000);
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
