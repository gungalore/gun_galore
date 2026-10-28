// The 15-minute BUY_NOW checkout hold: opening the checkout reserves ONE unit,
// Pay claims it instead of reserving again, and the sweep returns it if the
// clock runs out. Auction wins/offers never carry one.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ConflictException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';
import { CreateTransactionDto } from './dto/create-transaction.dto';

const NOW = Date.now();

function makeListing(over: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'BUY_NOW',
    status: 'ACTIVE',
    isFirearm: false,
    collectionOnly: false,
    requiresPapers: false,
    isExperience: false,
    isDealListing: false,
    price: 100_000,
    currentBid: null,
    currentBidderId: null,
    endedAt: null,
    expiresAt: null,
    trackInventory: false,
    quantityAvailable: 1,
    quantityReserved: 0,
    passFeeToBuyer: true,
    shippingMethods: [],
    seller: { sellerTier: 'STANDARD', kycStatus: 'VERIFIED' },
    ...over,
  };
}

function makeHeldListing(over: Record<string, unknown> = {}) {
  return makeListing({ status: 'PAYMENT_PENDING', ...over });
}

function makeService(listing: Record<string, unknown>) {
  const created: { data: Record<string, unknown> } = { data: {} };
  const txClient = {
    transaction: {
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) => {
          created.data = args.data;
          return Promise.resolve({ id: 'TX1', ...args.data });
        }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    checkoutHold: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    listing: {
      findUnique: jest.fn().mockResolvedValue({ trackInventory: false }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'B1', isBanned: false, username: 'buyer' }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(listing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: {
      create: txClient.transaction.create,
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    checkoutHold: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'H1',
          listingId: 'L1',
          buyerId: 'B1',
          quantity: 1,
          expiresAt: new Date(NOW + 15 * 60_000),
          createdAt: new Date(NOW),
          ...args.data,
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (t: unknown) => unknown)(txClient),
    ),
  };
  const shipping = {
    quoteForSelection: jest.fn().mockResolvedValue({
      priceCents: 0,
      serviceCode: 'bobgo_door',
    }),
  };
  const ozow = { getPaymentStatus: jest.fn() };
  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never, // notifications
    ozow as never,
    { triggerSellerVerification: jest.fn().mockResolvedValue(undefined) } as never,
    shipping as never,
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );
  const reserve = (dto: CreateTransactionDto) =>
    (
      service as unknown as {
        reserveAndCreateLine: (c: string, d: CreateTransactionDto) => Promise<unknown>;
      }
    ).reserveAndCreateLine('B1', dto);

  return { service, prisma, txClient, reserve, created, shipping, ozow };
}

function holdRow(over: Record<string, unknown> = {}) {
  return {
    id: 'H1',
    listingId: 'L1',
    buyerId: 'B1',
    quantity: 1,
    claimedAt: null,
    expiresAt: new Date(NOW + 10 * 60_000),
    createdAt: new Date(NOW),
    ...over,
  };
}

function checkoutDto(over: Partial<CreateTransactionDto> = {}): CreateTransactionDto {
  return {
    listingId: 'L1',
    shippingMethod: 'COURIER',
    deliveryAddress: {
      streetAddress: '1 Test Road',
      suburb: 'Testville',
      city: 'Pretoria',
      province: 'GAUTENG',
      postalCode: '0001',
    },
    buyerTermsAccepted: true,
    quantity: 1,
    ...over,
  };
}

describe('checkout holds (15-minute BUY_NOW reservation)', () => {
  it('reserves exactly ONE unit of a tracked listing', async () => {
    const { service, prisma } = makeService(
      makeListing({ trackInventory: true, quantityAvailable: 5 }),
    );

    const hold = await service.createCheckoutHold('B1', 'L1');

    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          quantityAvailable: { decrement: 1 },
          quantityReserved: { increment: 1 },
        },
      }),
    );
    expect(hold.quantity).toBe(1);
    expect(new Date(hold.expiresAt).getTime()).toBeGreaterThan(NOW + 14 * 60_000);
  });

  it('takes the single item off sale for a legacy listing', async () => {
    const { service, prisma } = makeService(makeListing());

    await service.createCheckoutHold('B1', 'L1');

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'ACTIVE' },
      data: { status: 'PAYMENT_PENDING' },
    });
  });

  it('reuses a live hold instead of reserving a second unit', async () => {
    const { service, prisma } = makeService(makeHeldListing());
    prisma.checkoutHold.findUnique.mockResolvedValue(holdRow());

    const hold = await service.createCheckoutHold('B1', 'L1');

    expect(hold.holdId).toBe('H1');
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(prisma.checkoutHold.create).not.toHaveBeenCalled();
  });

  it('returns null for an expired hold', async () => {
    const { service, prisma } = makeService(makeListing());
    prisma.checkoutHold.findUnique.mockResolvedValue(
      holdRow({ expiresAt: new Date(NOW - 1) }),
    );

    await expect(service.getCheckoutHold('B1', 'L1')).resolves.toBeNull();
  });

  it('releases an expired hold and restocks its unit', async () => {
    const { service, prisma, txClient } = makeService(
      makeListing({ trackInventory: true, quantityAvailable: 4 }),
    );
    prisma.checkoutHold.findMany.mockResolvedValue([
      { id: 'H1', listingId: 'L1', quantity: 1, claimedAt: null },
    ]);
    txClient.listing.findUnique.mockResolvedValue({
      trackInventory: true,
      quantityAvailable: 0,
    });

    const res = await service.releaseExpiredCheckoutHolds();

    expect(res).toEqual({ released: 1 });
    expect(txClient.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          quantityAvailable: { increment: 1 },
          quantityReserved: { decrement: 1 },
        }),
      }),
    );
  });

  it('Pay claims the hold and deletes it with the sale row, without reserving again', async () => {
    const { service, prisma, txClient, reserve, created } = makeService(
      makeHeldListing(),
    );
    prisma.checkoutHold.findUnique.mockResolvedValue(holdRow());

    await reserve(checkoutDto({ holdId: 'H1' }));

    expect(prisma.checkoutHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { claimedAt: expect.any(Date) },
      }),
    );
    // The hold's own reservation is the sale reservation — no second CAS.
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(created.data).toMatchObject({ listingId: 'L1', quantity: 1 });
    expect(txClient.checkoutHold.deleteMany).toHaveBeenCalled();
  });

  it('Pay rejects an expired hold before creating a sale', async () => {
    const { service, prisma, reserve, created } = makeService(
      makeHeldListing(),
    );
    prisma.checkoutHold.findUnique.mockResolvedValue(
      holdRow({ expiresAt: new Date(NOW - 1) }),
    );

    await expect(
      reserve(checkoutDto({ holdId: 'H1' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(created.data).toEqual({});
  });

  it('reclaims the buyer’s abandoned Ozow checkout and starts a fresh hold', async () => {
    const { service, prisma, txClient, ozow } = makeService(
      makeHeldListing(),
    );
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'TXOLD',
      gatewayCheckoutId: 'PAY1',
      quantity: 1,
      listing: { trackInventory: false },
    });
    ozow.getPaymentStatus.mockResolvedValue({
      isSuccess: false,
      status: 'Incomplete',
    });

    const hold = await service.createCheckoutHold('B1', 'L1');

    expect(ozow.getPaymentStatus).toHaveBeenCalledWith('PAY1');
    expect(txClient.transaction.deleteMany).toHaveBeenCalledWith({
      where: { id: 'TXOLD', paidAt: null, paymentStatus: 'HELD' },
    });
    expect(txClient.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'PAYMENT_PENDING' },
      data: { status: 'ACTIVE' },
    });
    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'ACTIVE' },
      data: { status: 'PAYMENT_PENDING' },
    });
    expect(hold.holdId).toBe('H1');
  });

  it('never releases an unpaid-looking checkout Ozow says is paid', async () => {
    const { service, prisma, txClient, ozow } = makeService(
      makeHeldListing(),
    );
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'TXOLD',
      gatewayCheckoutId: 'PAY1',
      quantity: 1,
      listing: { trackInventory: false },
    });
    ozow.getPaymentStatus.mockResolvedValue({
      isSuccess: true,
      status: 'Successful',
    });

    await expect(service.createCheckoutHold('B1', 'L1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(txClient.transaction.deleteMany).not.toHaveBeenCalled();
  });

  it('does not release when the Ozow status lookup fails', async () => {
    const { service, prisma, txClient, ozow } = makeService(
      makeHeldListing(),
    );
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'TXOLD',
      gatewayCheckoutId: 'PAY1',
      quantity: 1,
      listing: { trackInventory: false },
    });
    ozow.getPaymentStatus.mockRejectedValue(new Error('ozow 503'));

    await expect(service.createCheckoutHold('B1', 'L1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(txClient.transaction.deleteMany).not.toHaveBeenCalled();
  });
});
