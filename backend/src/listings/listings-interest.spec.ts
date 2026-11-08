jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotFoundException } from '@nestjs/common';
import { ListingsService } from './listings.service';

// The seller-facing interest panel is the one place a seller sees "how many
// people looked at my listing", so the two things that can quietly make that
// number WRONG are pinned here:
//
//   1. The seller's own views must not count — but anonymous views must still
//      count, because server-side recording has no device id and anonymous
//      rows are the majority. A naive `userId: { not: sellerId }` compiles to
//      `userId <> $1`, which is NULL (and false) for anonymous rows, so it
//      would hide most traffic instead of filtering one person.
//   2. A non-owner must get 404, not 403 — otherwise the endpoint confirms
//      which listing ids exist to anyone who guesses.

const SELLER = 'seller-1';
const OTHER = 'someone-else';

function makeService(
  listing: Record<string, unknown> | null,
  counts: {
    views?: number;
    views7d?: number;
    saves7d?: number;
    offers7d?: number;
    questions7d?: number;
    watchers7d?: number;
    bids7d?: number;
    openOffers?: number;
  } = {},
) {
  const userEventCount = jest.fn(
    (args: { where: { createdAt?: unknown; [key: string]: unknown } }) =>
      Promise.resolve(
        args.where.createdAt ? (counts.views7d ?? 0) : (counts.views ?? 0),
      ),
  );
  const offerCount = jest.fn(
    (args: { where: { createdAt?: unknown; status?: unknown } }) =>
      Promise.resolve(
        args.where.status
          ? (counts.openOffers ?? 0)
          : (counts.offers7d ?? 0),
      ),
  );

  const prisma = {
    listing: { findUnique: jest.fn().mockResolvedValue(listing) },
    userEvent: { count: userEventCount },
    watchedListing: {
      count: jest.fn().mockResolvedValue(counts.saves7d ?? 0),
    },
    offer: { count: offerCount },
    listingQuestion: {
      count: jest.fn().mockResolvedValue(counts.questions7d ?? 0),
    },
    auctionWatch: {
      count: jest.fn().mockResolvedValue(counts.watchers7d ?? 0),
    },
    bid: { count: jest.fn().mockResolvedValue(counts.bids7d ?? 0) },
  };

  const svc = Object.create(ListingsService.prototype) as Record<string, any>;
  Object.assign(svc, { prisma });
  return { svc: svc as ListingsService, prisma };
}

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sellerId: SELLER,
    status: 'ACTIVE',
    listingType: 'BUY_NOW',
    createdAt: new Date(Date.now() - 19 * 86_400_000),
    bidCount: 0,
    _count: { wishlistedBy: 5, offers: 2, watchers: 0, questions: 3 },
    ...overrides,
  };
}

describe('ListingsService.interest', () => {
  it('404s a non-owner without querying any counters', async () => {
    const { svc, prisma } = makeService(listingRow({ sellerId: OTHER }));

    await expect(svc.interest('listing-1', SELLER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.userEvent.count).not.toHaveBeenCalled();
    expect(prisma.watchedListing.count).not.toHaveBeenCalled();
  });

  it('404s a missing listing', async () => {
    const { svc } = makeService(null);
    await expect(svc.interest('nope', SELLER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('counts anonymous views but never the seller’s own', async () => {
    const { svc, prisma } = makeService(listingRow(), {
      views: 231,
      views7d: 42,
    });

    const result = await svc.interest('listing-1', SELLER);

    const where = prisma.userEvent.count.mock.calls[0][0].where;
    // Anonymous rows survive the seller filter…
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { userId: null },
        { userId: { not: SELLER } },
      ]),
    );
    // …and the seller is named explicitly, never a bare `not`.
    expect(JSON.stringify(where)).toContain(SELLER);
    expect(result.views).toEqual({ total: 231, last7d: 42 });
  });

  it('bounds the 7-day figures to a rolling week', async () => {
    const { svc, prisma } = makeService(listingRow(), { views: 10, views7d: 2 });

    const before = Date.now();
    await svc.interest('listing-1', SELLER);
    const after = Date.now();

    const weekCall = prisma.userEvent.count.mock.calls[1][0];
    const gte = (weekCall.where.createdAt as { gte: Date }).gte;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - 7 * 86_400_000);
    expect(gte.getTime()).toBeLessThanOrEqual(after - 7 * 86_400_000);

    // Saves/offers/questions use the same window, not a different one.
    expect(
      prisma.watchedListing.count.mock.calls[0][0].where.createdAt.gte,
    ).toEqual(gte);
    expect(prisma.listingQuestion.count.mock.calls[0][0].where.createdAt.gte).toEqual(
      gte,
    );
  });

  it('returns lifetime totals from the counts and the open-offer figure', async () => {
    const { svc } = makeService(listingRow(), {
      views: 231,
      views7d: 42,
      saves7d: 2,
      offers7d: 1,
      questions7d: 0,
      openOffers: 1,
    });

    const result = await svc.interest('listing-1', SELLER);

    expect(result).toMatchObject({
      listingId: 'listing-1',
      listingType: 'BUY_NOW',
      status: 'ACTIVE',
      liveSinceDays: 19,
      saves: { total: 5, last7d: 2 },
      offers: { total: 2, last7d: 1, open: 1 },
      questions: { total: 3, last7d: 0 },
    });
  });

  it('skips the auction-only queries for a buy-now listing', async () => {
    const { svc, prisma } = makeService(listingRow());

    const result = await svc.interest('listing-1', SELLER);

    expect(prisma.auctionWatch.count).not.toHaveBeenCalled();
    expect(prisma.bid.count).not.toHaveBeenCalled();
    expect(result.bids).toEqual({ total: 0, last7d: 0 });
    expect(result.watchers).toEqual({ total: 0, last7d: 0 });
  });

  it('includes bids and watchers on an auction', async () => {
    const { svc, prisma } = makeService(
      listingRow({
        listingType: 'AUCTION',
        bidCount: 12,
        _count: { wishlistedBy: 5, offers: 2, watchers: 4, questions: 3 },
      }),
      { watchers7d: 1, bids7d: 4 },
    );

    const result = await svc.interest('listing-1', SELLER);

    expect(prisma.auctionWatch.count).toHaveBeenCalled();
    expect(prisma.bid.count).toHaveBeenCalled();
    expect(result.bids).toEqual({ total: 12, last7d: 4 });
    expect(result.watchers).toEqual({ total: 4, last7d: 1 });
  });

  it('never reports a negative age for a future-dated row', async () => {
    const { svc } = makeService(
      listingRow({ createdAt: new Date(Date.now() + 86_400_000) }),
    );
    const result = await svc.interest('listing-1', SELLER);
    expect(result.liveSinceDays).toBe(0);
  });
});
