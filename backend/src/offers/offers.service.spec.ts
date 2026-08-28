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
    { record: jest.fn() } as never,
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

// A listing that takes offers. It used to be defined by its TYPE — offers only
// existed on TAKE_A_SHOT — and is now defined by the flag, which is what the
// submit() guard actually reads. The type is left as TAKE_A_SHOT so the legacy
// path stays covered; acceptsOffers is what makes these cases valid.
function tasListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    status: 'ACTIVE',
    listingType: 'TAKE_A_SHOT',
    acceptsOffers: true,
    title: 'Test item',
    autoAcceptThreshold: null,
    autoDeclineThreshold: null,
    seller: { clerkId: 'seller-clerk', email: 's@x.co', notifyOffersEnabled: true },
    ...overrides,
  };
}

describe('submit — the 30% floor', () => {
  // Operator, 2026-08-28: "offers can only go below 30% of the value."
  // R 100.00 listed → R 70.00 is the least we take.
  const priced = () => tasListing({ price: 10_000 });

  it('refuses an offer more than 30% below the price, and writes nothing', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(priced());
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 6_999 }),
    ).rejects.toThrow(/at most 30% below/i);
    // Refused outright: no row, so no attempt is consumed and the buyer can
    // simply offer again at a real number.
    expect(prisma.offer.create).not.toHaveBeenCalled();
    expect(prisma.offer.update).not.toHaveBeenCalled();
  });

  it('accepts an offer exactly at the floor', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(priced());
    await service.submit('clerk-b', { listingId: 'L1', offerAmount: 7_000 });
    expect(prisma.offer.create).toHaveBeenCalled();
  });

  it('skips the floor when the listing has no price at all', async () => {
    // Legacy TAKE_A_SHOT: the buyer names the price, so there is nothing to
    // take 30% of. Measuring from zero would refuse every offer on them.
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing({ price: null }));
    await service.submit('clerk-b', { listingId: 'L1', offerAmount: 100 });
    expect(prisma.offer.create).toHaveBeenCalled();
  });

  it('still applies the floor when acceptsOffers is false', async () => {
    // The flag is no longer read — every listing takes offers — but the floor
    // is not a consequence of the flag and must not travel with it.
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(
      tasListing({ price: 10_000, acceptsOffers: false }),
    );
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 5_000 }),
    ).rejects.toThrow(/at most 30% below/i);
  });
});

describe('submit — gates', () => {
  // ⚠️ CLOSED IS NOT BANNED. A member who closed their own account and came
  // back to a stale tab used to fall through the ban gate and be told they
  // were suspended — an accusation we never made, in a screenshot they keep.
  it('refuses a closed account, and never with the ban wording', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'B1',
      isBanned: false,
      accountClosedAt: new Date('2026-08-22'),
      auctionStrikes: 0,
    });
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.toThrow(/has been closed/);
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.not.toThrow(/suspended|banned/i);
  });

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

  it('allows one offer per buyer per listing, and refuses the second', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing());
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      status: 'REJECTED',
      attemptCount: 1,
    });
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 10_000 }),
    ).rejects.toThrow(/already made your offer/);
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
  });

  it('threshold-meeting offer stays PENDING for seller confirmation (no instant accept)', async () => {
    // Operator policy 2026-07-23: auto-accept never accepts instantly —
    // the seller confirms. The offer is flagged metAutoAccept and the
    // seller notification runs in "meets your price" mode.
    const { service, prisma, spies } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(
      tasListing({ autoAcceptThreshold: 50_000 }),
    );
    const res = await service.submit('clerk-b', {
      listingId: 'L1',
      offerAmount: 50_000,
    });
    await flush();
    expect(res.autoAccepted).toBe(false);
    expect(res.meetsAutoAccept).toBe(true);
    const created = prisma.offer.create.mock.calls[0][0].data;
    expect(created.status).toBe(OfferStatus.PENDING);
    expect(created.metAutoAccept).toBe(true);
    expect(spies.notifyBuyerOfAccept).not.toHaveBeenCalled();
    expect(spies.notifySellerOfOffer).toHaveBeenCalledWith(expect.anything(), true);
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

  // ⚠️ THIS TEST WAS INVERTED, NOT DELETED. It used to assert that a buyer
  // whose offer had been closed could open a FRESH ROUND on the same row —
  // correct under the old five-attempt allowance, and impossible under "one
  // chance to make a reasonable offer" (operator, 2026-08-27). The re-offer
  // path still exists in the service for the general case, so this now guards
  // the rule from the other side: a closed offer must not become a new one,
  // and nothing may be written when it is refused.
  it('refuses a second offer after the first was closed, and writes nothing', async () => {
    const { service, prisma } = makeMocks();
    prisma.listing.findUnique.mockResolvedValue(tasListing());
    prisma.offer.findUnique.mockResolvedValue({
      id: 'O1',
      status: 'REJECTED',
      attemptCount: 1,
    });
    await expect(
      service.submit('clerk-b', { listingId: 'L1', offerAmount: 12_000 }),
    ).rejects.toThrow(/already made your offer/);
    expect(prisma.offer.update).not.toHaveBeenCalled();
    expect(prisma.offer.create).not.toHaveBeenCalled();
    expect(prisma.offer.delete).not.toHaveBeenCalled();
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
