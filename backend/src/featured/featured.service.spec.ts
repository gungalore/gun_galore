import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FeaturedService,
  tierAmount,
  applyFeaturedDiscount,
  BUY_NOW_MULTIPLIER,
} from './featured.service';

// Locks the featured-slot Buy Now engine: the 2× tier-price premium, the
// subscription-discount snapshot, the payment-rail inertness (no free
// featuring while payments aren't live), and the CAS-on-final-claim race
// guard that stops two buyers (or a buyer + auction-close) both taking one
// slot.

const CFG = {
  id: 'default',
  slotCount: 10,
  bidFloorCents: 10000,
  t1AmountCents: 10000, t1DurationSec: 86400,
  t2AmountCents: 20000, t2DurationSec: 172800,
  t3AmountCents: 30000, t3DurationSec: 432000,
  t4AmountCents: 40000, t4DurationSec: 604800,
  t5AmountCents: 50000, t5DurationSec: 1209600,
  bidWindowSec: 86400,
  bindWindowSec: 900,
};

// Fresh mock graph per test. `tx` is what $transaction hands the callback.
function makeMocks() {
  const tx = {
    featuredSlot: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    listing: { findUnique: jest.fn() },
    featuredSlotBid: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'BID1' }),
    },
    featuredAuction: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'AUCNEW' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    featuredSlotAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'U1',
        isBanned: false,
        subscriptionTier: 'FREE',
      }),
    },
    featuredSlot: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    featuredAuction: {
      create: jest.fn().mockResolvedValue({ id: 'AUCNEW' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    featuredSlotBidderBan: { findUnique: jest.fn().mockResolvedValue(null) },
    featuredSlotConfig: {
      findUnique: jest.fn().mockResolvedValue(CFG),
      create: jest.fn().mockResolvedValue(CFG),
    },
    featuredSlotAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(
      (fn: (t: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx),
    ),
  };
  const zohoBooks = { createFeaturedSlotInvoice: jest.fn().mockResolvedValue(undefined) };
  const stitch = {};
  const notifications = {};
  const referenceNumbers = {};
  const service = new FeaturedService(
    prisma as never,
    stitch as never,
    zohoBooks as never,
    notifications as never,
    referenceNumbers as never,
  );
  return { service, prisma, tx, zohoBooks };
}

function auctionRunningSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'SLOT1',
    slotNumber: 1,
    status: 'AUCTION_RUNNING',
    currentAuctionId: 'AUC1',
    currentAuction: { id: 'AUC1', status: 'OPEN' },
    currentListingId: null,
    currentSellerId: null,
    ...overrides,
  };
}

function myActiveListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'U1',
    status: 'ACTIVE',
    isDealListing: false,
    featuredInSlot: null,
    // Mirrors the Prisma select: offers filtered to ACCEPTED (empty = none),
    // which the entry-guard reads via listing.offers.length.
    offers: [],
    ...overrides,
  };
}

// ─── Pure tier maths ──────────────────────────────────────────────────
describe('Buy Now pricing', () => {
  it('the premium is exactly 2× the tier base', () => {
    expect(BUY_NOW_MULTIPLIER).toBe(2);
    expect(tierAmount('T1', CFG) * BUY_NOW_MULTIPLIER).toBe(20000);
    expect(tierAmount('T3', CFG) * BUY_NOW_MULTIPLIER).toBe(60000);
    expect(tierAmount('T5', CFG) * BUY_NOW_MULTIPLIER).toBe(100000);
  });

  it('PRO discount applies to the doubled base (nets the plain tier price)', () => {
    // T3 base R300 → Buy Now R600 → PRO −50% → R300
    expect(applyFeaturedDiscount(tierAmount('T3', CFG) * BUY_NOW_MULTIPLIER, 50)).toBe(30000);
    // FREE pays the full doubled price
    expect(applyFeaturedDiscount(tierAmount('T3', CFG) * BUY_NOW_MULTIPLIER, 0)).toBe(60000);
  });
});

// ─── Gate + ban checks (manual rail = current prod state) ─────────────
describe('buyNow — inert until payments live', () => {
  it('is a no-op 503 on the manual rail (no free featuring)', async () => {
    // Default env: PAYMENT_MODE=manual, PAYMENTS_LIVE unset → assertPaymentsLive throws.
    const { service, tx } = makeMocks();
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Crucially: no slot/listing/CAS writes ran — the gate fired first.
    expect(tx.featuredSlot.updateMany).not.toHaveBeenCalled();
    expect(tx.featuredSlotBid.create).not.toHaveBeenCalled();
  });

  it('rejects a banned account', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'U1', isBanned: true, subscriptionTier: 'FREE' });
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a featured-slot-banned bidder', async () => {
    const { service, prisma } = makeMocks();
    prisma.featuredSlotBidderBan.findUnique.mockResolvedValue({ userId: 'U1', reason: 'spam' });
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─── Slot + listing validation + CAS race guard (paygate rail) ────────
// The payment gate short-circuits the manual rail before any of this
// logic, so exercise it on a freshly-required paygate build.
describe('buyNow — paygate rail (slot/listing/CAS)', () => {
  let PaygateService: typeof FeaturedService;

  beforeAll(() => {
    jest.isolateModules(() => {
      process.env.PAYMENT_MODE = 'paygate';
      PaygateService = require('./featured.service').FeaturedService;
    });
  });

  function makePaygateMocks() {
    const { prisma, tx, zohoBooks } = makeMocks();
    // Rebuild the service from the paygate-rail class using the same mocks.
    const service = new PaygateService(
      prisma as never,
      {} as never,
      zohoBooks as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, tx, zohoBooks };
  }

  it('features the listing immediately for the tier duration + records a WON buy-now bid', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());
    tx.listing.findUnique.mockResolvedValue(myActiveListing());

    const res = await service.buyNow('clerk1', 'SLOT1', 'T3', 'L1');

    // Bid: 2× T3 base, full price (FREE), flagged as a buy-now, WON + paid.
    expect(tx.featuredSlotBid.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 60000,
          chargedAmountCents: 60000,
          tier: 'T3',
          isBuyNow: true,
          status: 'WON',
        }),
      }),
    );
    // Slot claimed OCCUPIED via a status-guarded CAS.
    const claim = tx.featuredSlot.updateMany.mock.calls[0][0];
    expect(claim.where.status.in).toEqual(['AUCTION_RUNNING', 'VACANT']);
    expect(claim.data.status).toBe('OCCUPIED');
    expect(claim.data.currentListingId).toBe('L1');
    // featuredUntil ≈ now + T3 duration (5 days).
    const untilMs = (res as { featuredUntil: Date }).featuredUntil.getTime();
    expect(Math.abs(untilMs - (Date.now() + 432000 * 1000))).toBeLessThan(5000);
  });

  it('reuses the open auction and marks its outstanding bids LOST', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());
    tx.listing.findUnique.mockResolvedValue(myActiveListing());
    await service.buyNow('clerk1', 'SLOT1', 'T2', 'L1');
    expect(tx.featuredSlotBid.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { auctionId: 'AUC1', status: 'ACTIVE' },
        data: { status: 'LOST' },
      }),
    );
    expect(tx.featuredAuction.create).not.toHaveBeenCalled();
  });

  it('creates a fresh closed auction on a VACANT slot with no auction', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(
      auctionRunningSlot({ status: 'VACANT', currentAuctionId: null, currentAuction: null }),
    );
    tx.listing.findUnique.mockResolvedValue(myActiveListing());
    await service.buyNow('clerk1', 'SLOT1', 'T1', 'L1');
    expect(tx.featuredAuction.create).toHaveBeenCalled();
  });

  // NB: the paygate service is loaded in an isolated module registry, so its
  // Nest exception classes are a different object identity than this file's
  // imports — assert on the message (registry-independent), not instanceof.
  it('rejects a slot that is not AUCTION_RUNNING or VACANT', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot({ status: 'OCCUPIED' }));
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toThrow(/not available for Buy Now/i);
  });

  it('rejects when the final CAS loses the race (slot taken under us)', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());
    tx.listing.findUnique.mockResolvedValue(myActiveListing());
    tx.featuredSlot.updateMany.mockResolvedValue({ count: 0 }); // someone else claimed it
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toThrow(/just claimed by someone else/i);
  });

  it("rejects a listing that isn't the buyer's", async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());
    tx.listing.findUnique.mockResolvedValue(myActiveListing({ sellerId: 'SOMEONE_ELSE' }));
    await expect(
      service.buyNow('clerk1', 'SLOT1', 'T3', 'L1'),
    ).rejects.toThrow(/not yours/i);
  });

  it('rejects a non-ACTIVE / deal / already-featured listing', async () => {
    const { service, tx } = makePaygateMocks();
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());

    tx.listing.findUnique.mockResolvedValueOnce(myActiveListing({ status: 'SOLD' }));
    await expect(service.buyNow('c', 'SLOT1', 'T3', 'L1')).rejects.toThrow(/must be ACTIVE/i);

    tx.listing.findUnique.mockResolvedValueOnce(myActiveListing({ isDealListing: true }));
    await expect(service.buyNow('c', 'SLOT1', 'T3', 'L1')).rejects.toThrow(/Daily Deals cannot be featured/i);

    tx.listing.findUnique.mockResolvedValueOnce(myActiveListing({ featuredInSlot: { id: 'OTHER' } }));
    await expect(service.buyNow('c', 'SLOT1', 'T3', 'L1')).rejects.toThrow(/already featured/i);

    // Accepted-offer entry guard: an item already promised to a buyer can't
    // be featured (the recycler would reclaim the slot on the next tick).
    tx.listing.findUnique.mockResolvedValueOnce(myActiveListing({ offers: [{ id: 'OF1' }] }));
    await expect(service.buyNow('c', 'SLOT1', 'T3', 'L1')).rejects.toThrow(/accepted offer/i);
  });

  it('gives a PRO buyer 50% off the doubled base', async () => {
    const { service, prisma, tx } = makePaygateMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'U1', isBanned: false, subscriptionTier: 'PRO' });
    tx.featuredSlot.findUnique.mockResolvedValue(auctionRunningSlot());
    tx.listing.findUnique.mockResolvedValue(myActiveListing());
    await service.buyNow('clerk1', 'SLOT1', 'T3', 'L1');
    expect(tx.featuredSlotBid.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 60000, // 2× base still recorded as the face
          chargedAmountCents: 30000, // −50% PRO
          discountPercent: 50,
          isBuyNow: true,
        }),
      }),
    );
  });
});

// ─── Lifecycle CAS guards (closeAuction / openAuction) ────────────────
// Buy Now added a SECOND writer on OPEN auctions + VACANT slots, so the
// cron lifecycle writers must be CAS-guarded to not clobber a committed
// buy-now purchase. These lock those guards in.
describe('closeAuction — CAS guard vs a buy-now that already won', () => {
  it('is a no-op on the slot when the auction is no longer OPEN', async () => {
    const { service, tx } = makeMocks();
    tx.featuredAuction.findUnique.mockResolvedValue({
      id: 'AUC1', status: 'OPEN', slotId: 'SLOT1', slot: { id: 'SLOT1' },
    });
    // A live top bid → AWARDED branch.
    tx.featuredSlotBid.findFirst.mockResolvedValue({ id: 'TOP', amountCents: 30000, bidderId: 'B9' });
    // The guarded auction transition matches 0 rows: a concurrent buyNow
    // already flipped this auction to CLOSED_AWARDED.
    tx.featuredAuction.updateMany.mockResolvedValue({ count: 0 });

    await service.closeAuction('AUC1');

    // Critical: the slot must NOT be touched — the buy-now occupant stands.
    expect(tx.featuredSlot.updateMany).not.toHaveBeenCalled();
    expect(tx.featuredSlotBid.updateMany).not.toHaveBeenCalled();
  });

  it('closes + moves the slot to BIND_WINDOW when it still owns the auction', async () => {
    const { service, tx } = makeMocks();
    tx.featuredAuction.findUnique.mockResolvedValue({
      id: 'AUC1', status: 'OPEN', slotId: 'SLOT1', slot: { id: 'SLOT1' },
    });
    tx.featuredSlotBid.findFirst.mockResolvedValue({ id: 'TOP', amountCents: 30000, bidderId: 'B9' });
    tx.featuredAuction.updateMany.mockResolvedValue({ count: 1 }); // we won the transition

    await service.closeAuction('AUC1');

    const slotCall = tx.featuredSlot.updateMany.mock.calls[0][0];
    expect(slotCall.where).toMatchObject({
      id: 'SLOT1', currentAuctionId: 'AUC1', status: 'AUCTION_RUNNING',
    });
    expect(slotCall.data.status).toBe('BIND_WINDOW');
  });
});

describe('openAuction — CAS guard vs a buy-now that took the VACANT slot', () => {
  it('backs out the created auction and does not re-auction when the slot is no longer VACANT', async () => {
    const { service, prisma } = makeMocks();
    prisma.featuredSlot.findUnique.mockResolvedValue({ id: 'SLOT1', currentAuctionId: null });
    prisma.featuredAuction.create.mockResolvedValue({ id: 'AUCX' });
    prisma.featuredSlot.updateMany.mockResolvedValue({ count: 0 }); // buyNow claimed it

    await service.openAuction('SLOT1');

    // The orphan auction must be deleted, and no AUCTION_OPENED recorded.
    expect(prisma.featuredAuction.delete).toHaveBeenCalledWith({ where: { id: 'AUCX' } });
    expect(prisma.featuredSlotAuditEvent.create).not.toHaveBeenCalled();
  });

  it('opens the auction when the slot is genuinely VACANT', async () => {
    const { service, prisma } = makeMocks();
    prisma.featuredSlot.findUnique.mockResolvedValue({ id: 'SLOT1', currentAuctionId: null });
    prisma.featuredAuction.create.mockResolvedValue({ id: 'AUCX' });
    prisma.featuredSlot.updateMany.mockResolvedValue({ count: 1 });

    await service.openAuction('SLOT1');

    expect(prisma.featuredAuction.delete).not.toHaveBeenCalled();
    const claim = prisma.featuredSlot.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'SLOT1', status: 'VACANT', currentAuctionId: null });
  });
});
