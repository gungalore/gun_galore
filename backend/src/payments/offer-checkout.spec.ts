// Regression guard for the retired TAKE_A_SHOT checkout gate: an accepted
// offer on a Buy Now listing used to 400 at Pay, and an accepted offer on an
// auction had no settlement path at all. Both are payable now:
//   - Buy Now: the listing was reserved when the seller accepted, so checkout
//     must NOT reserve a second time;
//   - Auction: the accept promoted the listing to the normal winner state, so
//     checkout must claim the 24h window and use the auction fee split.
//
// create() calls assertPaymentsLive() first, so we stub ./payment-mode.

jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('./payment-mode', () => ({
  PAYMENT_MODE: 'paygate',
  PAYMENTS_LIVE: true,
  assertPaymentsLive: () => undefined,
}));

import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';
import { CreateTransactionDto } from './dto/create-transaction.dto';

const EXPIRES = new Date(Date.now() + 24 * 60 * 60 * 1000);

function listing(over: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'BUY_NOW',
    status: 'PAYMENT_PENDING',
    endedAt: null,
    expiresAt: null,
    currentBid: null,
    currentBidderId: null,
    price: 500_000,
    sellerAskCents: 500_000,
    isFirearm: false,
    collectionOnly: false,
    requiresPapers: false,
    isExperience: false,
    isDealListing: false,
    trackInventory: false,
    quantityAvailable: 1,
    quantityReserved: 0,
    passFeeToBuyer: true,
    shippingMethods: [],
    seller: { sellerTier: 'STANDARD', kycStatus: 'VERIFIED' },
    ...over,
  };
}

function offer(over: Record<string, unknown> = {}) {
  return {
    id: 'O1',
    listingId: 'L1',
    buyerId: 'B1',
    status: 'ACCEPTED',
    offerAmount: 400_000,
    counterAmount: null,
    ...over,
  };
}

function makeService(listingRow: Record<string, unknown>, offerRow: Record<string, unknown>) {
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        isBanned: false,
        email: 'b@x.co',
        username: 'buyer',
      }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(listingRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    offer: {
      findUnique: jest.fn().mockResolvedValue(offerRow),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: {
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'TX1', ...args.data }),
        ),
      update: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'TX1', ...args.data }),
        ),
    },
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );
  const ozow = {
    createPayment: jest.fn().mockResolvedValue({
      paymentId: 'pay-1',
      merchantReference: 'ref-1',
      redirectUrl: 'https://pay.test/1',
    }),
  };
  const shipping = {
    quoteForSelection: jest
      .fn()
      .mockResolvedValue({ priceCents: 5_000, serviceCode: 'bobgo_door' }),
  };
  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never,
    ozow as never,
    { triggerSellerVerification: jest.fn() } as never,
    shipping as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, ozow };
}

function dto(): CreateTransactionDto {
  return {
    listingId: 'L1',
    offerId: 'O1',
    shippingMethod: 'COURIER',
    deliveryAddress: {
      streetAddress: '1 Main Road',
      suburb: 'Milpark',
      city: 'Johannesburg',
      postalCode: '2092',
      province: 'GAUTENG',
      lat: -26.18,
      lng: 28.01,
    },
    buyerTermsAccepted: true,
  } as CreateTransactionDto;
}

describe('accepted-offer checkout', () => {
  it('pays a Buy Now offer without reserving the listing a second time', async () => {
    const { service, prisma } = makeService(
      listing({ listingType: 'BUY_NOW', status: 'PAYMENT_PENDING' }),
      offer(),
    );

    const result = await service.create('B1', dto(), 'https://x.test');

    expect(result.transactionId).toBe('TX1');
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: 'L1',
        listingPrice: 400_000,
        buyerId: 'B1',
      }),
    });
    expect(prisma.offer.update).toHaveBeenCalledWith({
      where: { id: 'O1' },
      data: { status: 'CONVERTED', transactionId: 'TX1' },
    });
  });

  it('pays an auction offer through the winner path and claims the 24h window', async () => {
    const { service, prisma } = makeService(
      listing({
        listingType: 'AUCTION',
        status: 'PAYMENT_PENDING',
        endedAt: new Date(),
        expiresAt: EXPIRES,
        price: null,
        currentBid: 400_000,
        currentBidderId: 'B1',
      }),
      offer(),
    );

    const result = await service.create('B1', dto(), 'https://x.test');

    expect(result.transactionId).toBe('TX1');
    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'L1',
        status: 'PAYMENT_PENDING',
        expiresAt: { not: null },
      },
      data: { expiresAt: null },
    });
    const createData = prisma.transaction.create.mock.calls[0][0].data;
    expect(createData.listingPrice).toBe(400_000);
    // Auction split: seller pays 5% of the hammer.
    expect(createData.commissionZar).toBe(20_000);
    expect(createData.processingFee).toBe(20_250);
  });

  it('refuses an auction offer that has not been promoted to the winner state', async () => {
    const { service } = makeService(
      listing({
        listingType: 'AUCTION',
        status: 'ACTIVE',
        endedAt: null,
        expiresAt: null,
        price: 100_000,
      }),
      offer(),
    );

    await expect(service.create('B1', dto(), 'https://x.test')).rejects.toThrow(
      /not awaiting payment/i,
    );
  });
});
