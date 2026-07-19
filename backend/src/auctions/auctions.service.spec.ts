import { AuctionsService, bidIncrement } from './auctions.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

// Locks the bidding engine's rules: tiered increments, proxy duels
// (auto-bid vs auto-bid, one-shot vs proxy), snipe extension, reserve
// tracking, the CAS-with-retry concurrency guard (2026-07-18 hardening),
// and the end-of-auction sweep's CAS (a snipe-extended auction must NOT
// be finalized from a stale read).

const HOUR = 3600_000;

function makeMocks() {
  const tx = {
    listing: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    bid: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        isBanned: false,
        auctionStrikes: 0,
        email: null,
        phone: null,
      }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(null), // notify helpers no-op
      findMany: jest.fn().mockResolvedValue([]),
    },
    bid: { findMany: jest.fn().mockResolvedValue([]) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(
      (fn: (t: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx),
    ),
  };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    bidPlaced: jest.fn().mockResolvedValue(undefined),
    bidOutbid: jest.fn().mockResolvedValue(undefined),
    auctionWon: jest.fn().mockResolvedValue(undefined),
    auctionEndedForSeller: jest.fn().mockResolvedValue(undefined),
    auctionEndedLoser: jest.fn().mockResolvedValue(undefined),
    auctionWinnerLapsed: jest.fn().mockResolvedValue(undefined),
  };
  const actionTokens = { mint: jest.fn().mockResolvedValue('tok') };
  const service = new AuctionsService(
    prisma as never,
    notifications as never,
    actionTokens as never,
  );
  return { service, prisma, tx, notifications };
}

// A live auction fixture — override per test.
function activeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'AUCTION',
    status: 'ACTIVE',
    price: 10_000, // R100 starting bid
    reservePrice: null,
    currentBid: null,
    currentBidderId: null,
    bidCount: 0,
    reserveMet: false,
    endTime: new Date(Date.now() + HOUR),
    buyNowPrice: null,
    ...overrides,
  };
}

describe('bidIncrement tiers', () => {
  it('follows the CLAUDE.md price bands', () => {
    expect(bidIncrement(50_000)).toBe(5_000); // <R1,000 → R50
    expect(bidIncrement(100_000)).toBe(10_000); // <R5,000 → R100
    expect(bidIncrement(499_999)).toBe(10_000);
    expect(bidIncrement(999_999)).toBe(25_000); // <R10,000 → R250
    expect(bidIncrement(4_999_999)).toBe(50_000); // <R50,000 → R500
    expect(bidIncrement(5_000_000)).toBe(100_000); // >= R50,000 → R1,000
  });
});

describe('placeBid — validation gates', () => {
  it('rejects a bid below the starting bid', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(activeListing());
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 9_999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bid below current bid + increment', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 100_000, currentBidderId: 'U1', bidCount: 1 }),
    );
    // min = 100_000 + 10_000
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 105_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the seller from bidding on their own auction', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(activeListing({ sellerId: 'B1' }));
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 50_000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks banned bidders and 3-strike bidders', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'B1',
      isBanned: true,
      auctionStrikes: 0,
    });
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 50_000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.user.findUnique.mockResolvedValue({
      id: 'B1',
      isBanned: false,
      auctionStrikes: 3,
    });
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 50_000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects bids on an ended auction', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ endTime: new Date(Date.now() - 1000) }),
    );
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 50_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('placeBid — resolution', () => {
  it('first bid opens at the starting bid, not the max', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(activeListing());
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 50_000 });
    expect(res.currentBid).toBe(10_000);
    expect(res.youAreHighBidder).toBe(true);
    expect(tx.bid.create).toHaveBeenCalledTimes(1);
    expect(tx.bid.create.mock.calls[0][0].data).toMatchObject({
      bidderId: 'B1',
      amount: 10_000,
      maxAmount: 50_000,
    });
  });

  it('auto-bid duel: challenger with the higher max wins at loser-max + increment', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 10_000, currentBidderId: 'U1', bidCount: 3 }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 30_000 }); // holder's proxy
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 100_000 });
    // holder max 30_000 + R50 increment = 35_000
    expect(res.currentBid).toBe(35_000);
    expect(res.youAreHighBidder).toBe(true);
    // last-stand row for the beaten proxy, then the winner's row
    expect(tx.bid.create).toHaveBeenCalledTimes(2);
    expect(tx.bid.create.mock.calls[0][0].data).toMatchObject({
      bidderId: 'U1',
      amount: 30_000,
    });
    expect(tx.bid.create.mock.calls[1][0].data).toMatchObject({
      bidderId: 'B1',
      amount: 35_000,
      maxAmount: 100_000,
    });
    // bidCount +2 so the count matches the visible rows
    expect(tx.listing.updateMany.mock.calls[0][0].data.bidCount).toEqual({
      increment: 2,
    });
  });

  it('auto-bid duel: holder proxy counters a lower challenger', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 10_000, currentBidderId: 'U1', bidCount: 3 }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 30_000 });
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 20_000 });
    // challenger 20_000 + R50 inc = 25_000, capped by holder max 30_000
    expect(res.currentBid).toBe(25_000);
    expect(res.youAreHighBidder).toBe(false);
    expect(tx.bid.create).toHaveBeenCalledTimes(2);
    expect(tx.bid.create.mock.calls[1][0].data).toMatchObject({
      bidderId: 'U1',
      amount: 25_000,
      maxAmount: 30_000,
    });
  });

  it('one-shot that beats the proxy posts the exact amount (shows its hand)', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 10_000, currentBidderId: 'U1', bidCount: 2 }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 30_000 });
    const res = await service.placeBid('clerk1', 'L1', {
      maxAmount: 40_000,
      isOneShot: true,
    });
    expect(res.currentBid).toBe(40_000);
    expect(res.youAreHighBidder).toBe(true);
  });

  it('one-shot below the stored proxy is countered, not crowned', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 10_000, currentBidderId: 'U1', bidCount: 2 }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 30_000 });
    const res = await service.placeBid('clerk1', 'L1', {
      maxAmount: 20_000,
      isOneShot: true,
    });
    expect(res.currentBid).toBe(25_000);
    expect(res.youAreHighBidder).toBe(false);
  });

  it('the high bidder raising their own ceiling leaves the visible bid unchanged', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ currentBid: 15_000, currentBidderId: 'B1', bidCount: 2 }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 20_000 });
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 80_000 });
    expect(res.currentBid).toBe(15_000);
    expect(res.youAreHighBidder).toBe(true);
    expect(tx.bid.create).toHaveBeenCalledTimes(1);
    expect(tx.bid.create.mock.calls[0][0].data).toMatchObject({
      amount: 15_000,
      maxAmount: 80_000,
    });
  });

  it('a bid in the final 2 minutes extends the auction (snipe protection)', async () => {
    const { service, tx } = makeMocks();
    const endTime = new Date(Date.now() + 60_000); // 1 min left
    tx.listing.findUnique.mockResolvedValue(activeListing({ endTime }));
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 50_000 });
    expect(res.endTime.getTime()).toBeGreaterThan(endTime.getTime());
    // roughly now + 2 min
    expect(res.endTime.getTime()).toBeGreaterThan(Date.now() + 110_000);
  });

  it('sets reserveMet when the visible bid clears the hidden reserve', async () => {
    const { service, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(
      activeListing({
        currentBid: 18_000,
        currentBidderId: 'U1',
        bidCount: 1,
        reservePrice: 20_000,
      }),
    );
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 18_000 });
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 30_000 });
    expect(res.currentBid).toBe(23_000); // 18k + R50 inc
    expect(res.reserveMet).toBe(true);
  });
});

describe('placeBid — concurrency (CAS + retry)', () => {
  it('retries after a CAS conflict and succeeds on fresh state', async () => {
    const { service, prisma, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(activeListing());
    tx.listing.updateMany
      .mockResolvedValueOnce({ count: 0 }) // lost the race
      .mockResolvedValueOnce({ count: 1 }); // fresh attempt wins
    const res = await service.placeBid('clerk1', 'L1', { maxAmount: 50_000 });
    expect(res.youAreHighBidder).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up with 409 Conflict after exhausting retries', async () => {
    const { service, prisma, tx } = makeMocks();
    tx.listing.findUnique.mockResolvedValue(activeListing());
    tx.listing.updateMany.mockResolvedValue({ count: 0 }); // always loses
    await expect(
      service.placeBid('clerk1', 'L1', { maxAmount: 50_000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('guards the CAS on the exact snapshot it resolved against', async () => {
    const { service, tx } = makeMocks();
    const listing = activeListing({
      currentBid: 10_000,
      currentBidderId: 'U1',
      bidCount: 4,
    });
    tx.listing.findUnique.mockResolvedValue(listing);
    tx.bid.findFirst.mockResolvedValue({ maxAmount: 30_000 });
    await service.placeBid('clerk1', 'L1', { maxAmount: 100_000 });
    const where = tx.listing.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: 'L1',
      status: 'ACTIVE',
      endedAt: null,
      currentBid: 10_000,
      currentBidderId: 'U1',
      bidCount: 4,
      endTime: listing.endTime,
    });
  });
});

describe('endStale / finalizeAuction — CAS-guarded finalization', () => {
  it('crowns the winner and marks the winning bid when the CAS holds', async () => {
    const { service, prisma, tx } = makeMocks();
    prisma.listing.findMany.mockResolvedValue([{ id: 'L1' }]);
    tx.listing.findUnique.mockResolvedValue(
      activeListing({
        currentBid: 35_000,
        currentBidderId: 'U1',
        bidCount: 4,
        endTime: new Date(Date.now() - 60_000),
      }),
    );
    tx.bid.findFirst.mockResolvedValue({ id: 'bid9' });
    const res = await service.endStale();
    expect(res.processed).toBe(1);
    expect(tx.listing.updateMany.mock.calls[0][0].data.status).toBe(
      'PAYMENT_PENDING',
    );
    // Re-asserts past-end at write time (snipe-extension guard)
    expect(
      tx.listing.updateMany.mock.calls[0][0].where.endTime.lt,
    ).toBeInstanceOf(Date);
    expect(tx.bid.update).toHaveBeenCalledWith({
      where: { id: 'bid9' },
      data: { isWinner: true },
    });
  });

  it('does NOT mark a winner when a concurrent bid moved the auction (CAS count 0)', async () => {
    const { service, prisma, tx } = makeMocks();
    prisma.listing.findMany.mockResolvedValue([{ id: 'L1' }]);
    tx.listing.findUnique.mockResolvedValue(
      activeListing({
        currentBid: 35_000,
        currentBidderId: 'U1',
        bidCount: 4,
        endTime: new Date(Date.now() - 1000),
      }),
    );
    tx.listing.updateMany.mockResolvedValue({ count: 0 }); // snipe bid landed
    await service.endStale();
    expect(tx.bid.update).not.toHaveBeenCalled();
  });

  it('expires a reserve-not-met auction instead of selling it', async () => {
    const { service, prisma, tx } = makeMocks();
    prisma.listing.findMany.mockResolvedValue([{ id: 'L1' }]);
    tx.listing.findUnique.mockResolvedValue(
      activeListing({
        currentBid: 15_000,
        currentBidderId: 'U1',
        bidCount: 2,
        reservePrice: 50_000,
        reserveMet: false,
        endTime: new Date(Date.now() - 1000),
      }),
    );
    await service.endStale();
    expect(tx.listing.updateMany.mock.calls[0][0].data.status).toBe('EXPIRED');
    expect(tx.bid.update).not.toHaveBeenCalled();
  });

  it('expires a no-bid auction', async () => {
    const { service, prisma, tx } = makeMocks();
    prisma.listing.findMany.mockResolvedValue([{ id: 'L1' }]);
    tx.listing.findUnique.mockResolvedValue(
      activeListing({ endTime: new Date(Date.now() - 1000) }),
    );
    await service.endStale();
    expect(tx.listing.updateMany.mock.calls[0][0].data.status).toBe('EXPIRED');
  });
});
