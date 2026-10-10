// Regression guard for the CRITICAL auction-zombie bug: when Ozow createPayment
// fails during an auction-WIN checkout, the old rollback flipped the listing to
// ACTIVE. That is a permanent zombie — finalizeAuction has already run (endedAt
// set) so it can never re-finalize, endTime is past so nobody can bid, and the
// winner-checkout branch requires PAYMENT_PENDING. The fix restores
// PAYMENT_PENDING + the original pay window so the winner can retry and the
// unpaid-winner sweep still applies. A plain BUY_NOW must still roll back to
// ACTIVE (unchanged).
//
// create() calls assertPaymentsLive() first, so we stub ./payment-mode (the
// module is a plain dependency-free seam) to bypass the launch gate.

jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('./payment-mode', () => ({
  PAYMENT_MODE: 'paygate',
  PAYMENTS_LIVE: true,
  assertPaymentsLive: () => undefined,
}));

import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';
import { CreateTransactionDto } from './dto/create-transaction.dto';

const EXPIRES = new Date('2026-10-11T12:00:00.000Z');

function auctionListing(over: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'AUCTION',
    status: 'PAYMENT_PENDING',
    endedAt: new Date('2026-10-10T10:00:00.000Z'),
    expiresAt: EXPIRES,
    currentBid: 500_000,
    currentBidderId: 'B1',
    price: null,
    isFirearm: false,
    collectionOnly: false,
    requiresPapers: false,
    isExperience: false,
    isDealListing: false,
    trackInventory: false,
    quantityAvailable: 1,
    quantityReserved: 0,
    passFeeToBuyer: true,
    sellerAskCents: null,
    shippingMethods: [],
    seller: { sellerTier: 'STANDARD', kycStatus: 'VERIFIED' },
    ...over,
  };
}

function makeService(listing: Record<string, unknown>) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        isBanned: false,
        email: 'b@x.co',
        username: 'buyer',
      }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(listing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: {
      create: jest
        .fn()
        .mockImplementation((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'TX1', ...args.data }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const ozow = {
    createPayment: jest.fn().mockRejectedValue(new Error('gateway down')),
  };
  const shipping = {
    quoteForSelection: jest
      .fn()
      .mockResolvedValue({ priceCents: 5_000, serviceCode: 'bobgo_door' }),
  };
  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never, // notifications
    ozow as never,
    { triggerSellerVerification: jest.fn() } as never, // kyc
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
  return { service, prisma, ozow };
}

function dto(): CreateTransactionDto {
  return {
    listingId: 'L1',
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

describe('auction-win Ozow-failure rollback', () => {
  it('restores PAYMENT_PENDING + the original pay window, never ACTIVE', async () => {
    const { service, prisma } = makeService(auctionListing());

    await expect(service.create('B1', dto(), 'https://x.test')).rejects.toThrow(
      'Payment processing failed',
    );

    expect(prisma.listing.update).toHaveBeenCalledTimes(1);
    const data = prisma.listing.update.mock.calls[0][0].data;
    expect(data.status).toBe('PAYMENT_PENDING');
    expect(data.expiresAt).toEqual(EXPIRES);
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
  });

  it('still rolls a plain BUY_NOW back to ACTIVE', async () => {
    const { service, prisma } = makeService(
      auctionListing({
        listingType: 'BUY_NOW',
        status: 'ACTIVE',
        endedAt: null,
        expiresAt: null,
        currentBid: null,
        currentBidderId: null,
        price: 500_000,
        sellerAskCents: 500_000,
      }),
    );

    await expect(service.create('B1', dto(), 'https://x.test')).rejects.toThrow(
      'Payment processing failed',
    );

    expect(prisma.listing.update.mock.calls[0][0].data).toEqual({
      status: 'ACTIVE',
    });
  });
});
