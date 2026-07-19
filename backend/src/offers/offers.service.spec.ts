import { OffersService } from './offers.service';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { OfferStatus } from '@prisma/client';

// Locks the Take a Shot engine's rules after the 2026-07-18 hardening:
// single-promise acceptance (sibling guard + auto-decline of rivals),
// CAS guards on EVERY transition, lowball auto-decline, the 5-attempt
// cap with update-in-place re-offers, counter sanity, withdraw hygiene,
// and the notifying + striking expiry sweep.

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeMocks() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        isBanned: false,
        auctionStrikes: 0,
      }),
      update: jest.fn().mockResolvedValue({ auctionStrikes: 1, username: 'buyer1' }),
    },
    listing: { findUnique: jest.fn() },
    offer: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'O1',
        ...args.data,
      })),
      update: jest.fn(
        async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => ({
          id: 'O1',
          ...args.data,
        }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
  };
  const contactFilter = {
    check: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const actionTokens = { mint: jest.fn().mockResolvedValue('tok') };
  const service = new OffersService(
    prisma as never,
    notifications as never,
    contactFilter as never,
    actionTokens as never,
  );
  // The notify wrappers re-fetch and fan out — irrelevant to the state
  // machine under test. Spy them out and assert the CALLS.
  const spies = {
    notifySellerOfOffer: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifySellerOfOffer' as never)
      .mockResolvedValue(undefined as never),
    notifyBuyerOfAccept: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyBuyerOfAccept' as never)
      .mockResolvedValue(undefined as never),
    notifyBuyerOfReject: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyBuyerOfReject' as never)
      .mockResolvedValue(undefined as never),
    notifySellerOfAutoAccept: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifySellerOfAutoAccept' as never)
      .mockResolvedValue(undefined as never),
    notifySellerOfWithdrawal: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifySellerOfWithdrawal' as never)
      .mockResolvedValue(undefined as never),
    notifyOfferExpired: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyOfferExpired' as never)
      .mockResolvedValue(undefined as never),
    notifyCounterExpired: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyCounterExpired' as never)
      .mockResolvedValue(undefined as never),
    notifyAcceptedLapsed: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyAcceptedLapsed' as never)
      .mockResolvedValue(undefined as never),
    notifyBuyerOfCounter: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyBuyerOfCounter' as never)
      .mockResolvedValue(undefined as never),
    notifySellerOfCounterAccepted: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifySellerOfCounterAccepted' as never)
      .mockResolvedValue(undefined as never),
    notifyBuyerOfCounterAccept: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifyBuyerOfCounterAccept' as never)
      .mockResolvedValue(undefined as never),
    notifySellerOfCounterRejected: jest
      .spyOn(service as never as Record<string, () => Promise<void>>, 'notifySellerOfCounterRejected' as never)
      .mockResolvedValue(undefined as never),
  };
  return { service, prisma, notifications, contactFilter, spies };
}

function tasListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    status: 'ACTIVE',
    listingType: 'TAKE_A_SHOT',
    title: 'Test item',
    autoAcceptThreshold: null,
    autoDeclineThreshold: null,
    seller: { clerkId: 'seller-clerk', email: 's@x.co' },
    ...overrides,
  };
}

describe('submit — gates', () => {
  it('blocks buyers with 3 unpaid-commitment strikes', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'B1',
      isBanned: false,
      auctionStrikes: 3,
    });
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks new offers when another offer is already ACCEPTED (single-promise rule)', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing());
    prisma.offer.findFirst.mockResolvedValue({ id: 'other' }); // sibling ACCEPTED
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.toThrow(/already accepted another offer/);
  });

  it('enforces the 5-attempt cap per listing', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing());
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      status: 'REJECTED',
      attemptCount: 5,
    });
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.toThrow(/limit of 5 offers/);
  });
});

describe('submit — resolution', () => {
  it('auto-declines at/below the lowball threshold: row REJECTED, buyer told, seller NOT told', async () => {
    const { service, prisma, spies } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(
      tasListing({ autoDeclineThreshold: 20_000 }),
    );
    const res = await service.submit('clerk-b', {
      listingId: 'L1',
      offerAmount: 15_000,
    });
    await flush();
    expect(res.autoDeclined).toBe(true);
    expect(prisma.offer.create.mock.calls[0][0].data.status).toBe(
      OfferStatus.REJECTED,
    );
    expect(spies.notifyBuyerOfReject).toHaveBeenCalled();
    expect(spies.notifySellerOfOffer).not.toHaveBeenCalled();
    expect(spies.notifySellerOfAutoAccept).not.toHaveBeenCalled();
  });

  it('auto-accepts at/above the threshold: siblings declined + BOTH parties told', async () => {
    const { service, prisma, spies } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(
      tasListing({ autoAcceptThreshold: 50_000 }),
    );
    const res = await service.submit('clerk-b', {
      listingId: 'L1',
      offerAmount: 50_000,
    });
    await flush();
    expect(res.autoAccepted).toBe(true);
    expect(prisma.offer.create.mock.calls[0][0].data.status).toBe(
      OfferStatus.ACCEPTED,
    );
    expect(spies.notifyBuyerOfAccept).toHaveBeenCalled();
    expect(spies.notifySellerOfAutoAccept).toHaveBeenCalled();
  });

  it('auto-decline wins when a nonsense config makes an offer match both thresholds', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(
      tasListing({ autoDeclineThreshold: 60_000, autoAcceptThreshold: 50_000 }),
    );
    const res = await service.submit('clerk-b', {
      listingId: 'L1',
      offerAmount: 55_000,
    });
    expect(res.autoDeclined).toBe(true);
    expect(res.autoAccepted).toBe(false);
  });

  it('re-offer after a close UPDATES the same row (audit identity), clears the old counter, bumps attemptCount', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing());
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      status: 'REJECTED',
      attemptCount: 2,
    });
    await service.submit('clerk-b', { listingId: 'L1', offerAmount: 12_000 });
    expect(prisma.offer.delete).not.toHaveBeenCalled();
    expect(prisma.offer.create).not.toHaveBeenCalled();
    const upd = prisma.offer.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'O1' });
    expect(upd.data).toMatchObject({
      offerAmount: 12_000,
      counterAmount: null,
      sellerNote: null,
      status: OfferStatus.PENDING,
      attemptCount: { increment: 1 },
    });
  });
});

describe('accept — single-promise + CAS', () => {
  function primeAccept(prisma: ReturnType<typeof makeMocks>['prisma']) {
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      listingId: 'L1',
      status: OfferStatus.PENDING,
      counterAmount: null,
      listing: tasListing(),
    });
  }

  it('refuses when another offer on the listing is already ACCEPTED', async () => {
    const { service, prisma } = makeMocks();
    primeAccept(prisma);
    prisma.offer.findFirst.mockResolvedValue({ id: 'other' });
    await expect(
      service.accept('seller-clerk', 'O1'),
    ).rejects.toThrow(/already accepted another offer/);
  });

  it('CAS: a concurrent transition surfaces as "no longer pending"', async () => {
    const { service, prisma } = makeMocks();
    primeAccept(prisma);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.accept('seller-clerk', 'O1')).rejects.toThrow(
      /no longer pending/,
    );
  });

  it('success declines every sibling offer', async () => {
    const { service, prisma, spies } = makeMocks();
    primeAccept(prisma);
    prisma.offer.findMany.mockResolvedValue([{ id: 'S-A' }, { id: 'S-B' }]);
    await service.accept('seller-clerk', 'O1');
    await flush();
    // sibling decline bulk update fired (REJECTED)
    const bulk = prisma.offer.updateMany.mock.calls.find(
      (c) => c[0].data?.status === OfferStatus.REJECTED,
    );
    expect(bulk).toBeTruthy();
    expect(spies.notifyBuyerOfReject).toHaveBeenCalledTimes(2);
    expect(spies.notifyBuyerOfAccept).toHaveBeenCalled();
  });
});

describe('counter / rejectCounter / withdraw — sanity + CAS', () => {
  it('rejects a counter at or below the buyer’s offer', async () => {
    const { service, prisma } = makeMocks();
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      listingId: 'L1',
      status: OfferStatus.PENDING,
      offerAmount: 20_000,
      counterAmount: null,
      listing: tasListing(),
    });
    await expect(
      service.counter('seller-clerk', 'O1', { counterAmount: 20_000 }),
    ).rejects.toThrow(/must be higher/);
  });

  it('counter uses a CAS and surfaces a lost race', async () => {
    const { service, prisma } = makeMocks();
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      listingId: 'L1',
      status: OfferStatus.PENDING,
      offerAmount: 20_000,
      counterAmount: null,
      listing: tasListing(),
    });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.counter('seller-clerk', 'O1', { counterAmount: 25_000 }),
    ).rejects.toThrow(/no longer pending/);
  });

  it('withdraw uses a CAS, clears the seller bell and notifies the seller', async () => {
    const { service, prisma, notifications, spies } = makeMocks();
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      listingId: 'L1',
      buyerId: 'B1',
      status: OfferStatus.PENDING,
      listing: tasListing(),
    });
    await service.withdraw('clerk-b', 'O1');
    await flush();
    expect(
      prisma.offer.updateMany.mock.calls[0][0].where,
    ).toMatchObject({ id: 'O1', status: OfferStatus.PENDING });
    expect(notifications.resolveByEntity).toHaveBeenCalledWith('offer', 'O1');
    expect(spies.notifySellerOfWithdrawal).toHaveBeenCalled();
  });

  it('withdraw racing an accept loses cleanly (no WITHDRAWN-over-ACCEPTED)', async () => {
    const { service, prisma } = makeMocks();
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      listingId: 'L1',
      buyerId: 'B1',
      status: OfferStatus.PENDING,
      listing: tasListing(),
    });
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.withdraw('clerk-b', 'O1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('expireStale — notifying + striking sweep', () => {
  it('routes each lapse to the right party and strikes unpaid accepted buyers', async () => {
    const { service, prisma, spies } = makeMocks();
    prisma.offer.findMany.mockResolvedValue([
      { id: 'P1', status: OfferStatus.PENDING, buyerId: 'B1', listingId: 'L1' },
      { id: 'C1', status: OfferStatus.COUNTERED, buyerId: 'B2', listingId: 'L2' },
      { id: 'A1', status: OfferStatus.ACCEPTED, buyerId: 'B3', listingId: 'L3' },
    ]);
    await service.expireStale();
    await flush();
    expect(spies.notifyOfferExpired).toHaveBeenCalledWith('P1');
    expect(spies.notifyCounterExpired).toHaveBeenCalledWith('C1');
    expect(spies.notifyAcceptedLapsed).toHaveBeenCalledWith('A1');
    // strike: user.update increments auctionStrikes for the lapsed buyer
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'B3' },
        data: expect.objectContaining({
          auctionStrikes: { increment: 1 },
        }),
      }),
    );
  });

  it('a decision landing mid-sweep wins over the expiry (claim 0 → no notice)', async () => {
    const { service, prisma, spies } = makeMocks();
    prisma.offer.findMany.mockResolvedValue([
      { id: 'P1', status: OfferStatus.PENDING, buyerId: 'B1', listingId: 'L1' },
    ]);
    prisma.offer.updateMany.mockResolvedValue({ count: 0 });
    await service.expireStale();
    await flush();
    expect(spies.notifyOfferExpired).not.toHaveBeenCalled();
  });
});

describe('getById — threshold privacy', () => {
  function primeGet(prisma: ReturnType<typeof makeMocks>['prisma'], viewerIsSeller: boolean) {
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      buyerId: 'B1',
      listing: {
        id: 'L1',
        title: 'x',
        autoAcceptThreshold: 50_000,
        passFeeToBuyer: true,
        isFirearm: false,
        shippingMethods: [],
        seller: { clerkId: 'seller-clerk', username: 's', email: 's@x.co' },
      },
      buyer: { clerkId: 'buyer-clerk', username: 'b' },
    });
    prisma.user.findUnique.mockResolvedValue({
      id: viewerIsSeller ? 'S1' : 'B1',
    });
  }

  it('hides the auto-accept threshold from the buyer', async () => {
    const { service, prisma } = makeMocks();
    primeGet(prisma, false);
    const res = await service.getById('buyer-clerk', 'O1');
    expect(res.listing.autoAcceptThreshold).toBeNull();
  });

  it('shows the auto-accept threshold to the seller', async () => {
    const { service, prisma } = makeMocks();
    primeGet(prisma, true);
    const res = await service.getById('seller-clerk', 'O1');
    expect(res.listing.autoAcceptThreshold).toBe(50_000);
  });
});
