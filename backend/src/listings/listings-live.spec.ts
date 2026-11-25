// Live browsing + social-proof counts.
//
// The browse grids poll /listings/live-version and re-render only when the
// token changes, and the cards render the wishlist save count that this spec
// pins onto the browse payload. These tests describe the two contracts that
// make that safe: the count appears on every collection path, and the token /
// stats endpoints cannot reveal a listing the caller is not allowed to see.

jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotFoundException } from '@nestjs/common';
import { FeeCalculator } from '../payments/fee.calculator';
import { ListingsService } from './listings.service';

function makeService(over: Record<string, unknown> = {}) {
  const prisma = {
    listing: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(over.listing ?? null),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 3 },
        _max: { updatedAt: new Date('2026-10-20T10:00:00.000Z') },
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    watchedListing: { count: jest.fn().mockResolvedValue(7) },
  };
  const service = new ListingsService(
    prisma as never,
    { isConnected: false } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: jest.fn() } as never,
    new FeeCalculator(),
    { resolveByEntity: jest.fn() } as never,
    { offerAtListingLive: jest.fn().mockResolvedValue(undefined) } as never, // kyc
  );
  return { service, prisma };
}

const VISIBLE = {
  status: 'ACTIVE',
  publicVisible: true,
  sellerId: 'seller_1',
  _count: { wishlistedBy: 4 },
};

describe('ListingsService - saved-count projection', () => {
  it('asks Prisma for the wishlist count on the browse grid', async () => {
    const { service, prisma } = makeService();
    await service.browse({ page: 1, limit: 20 });
    const includeMatcher: unknown = expect.objectContaining({
      _count: { select: { wishlistedBy: true } },
    });
    expect(prisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: includeMatcher }),
    );
  });
});

describe('ListingsService - live version token', () => {
  // Content no longer varies by sign-in: the 18+ gate is enforced by
  // ContentAccessGuard before the handler, so the poll token is identical
  // for every viewer who got this far. A publicVisible gate here would make
  // a declared visitor's grids refresh-only-when-tents-change.
  it('has no publicVisible gate for any viewer', async () => {
    const { service, prisma } = makeService();
    const out = await service.liveVersion();
    expect(out.v).toBe('3:1792490400000:7');

    const catalogWhere: unknown = expect.not.objectContaining({
      publicVisible: true,
    });
    expect(prisma.listing.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: catalogWhere }),
    );
    expect(prisma.watchedListing.count).toHaveBeenCalledWith({
      where: { listing: catalogWhere },
    });
  });

  it('does not restrict the token for a signed-in member', async () => {
    const { service, prisma } = makeService();
    await service.liveVersion('user_1');
    const unrestricted: unknown = expect.not.objectContaining({
      publicVisible: true,
    });
    expect(prisma.listing.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: unrestricted }),
    );
  });

  it('changes the token when the newest listing timestamp changes', async () => {
    const { service, prisma } = makeService();
    const first = await service.liveVersion();
    prisma.listing.aggregate.mockResolvedValueOnce({
      _count: { _all: 3 },
      _max: { updatedAt: new Date('2026-10-20T10:00:01.000Z') },
    });
    const second = await service.liveVersion();
    expect(second.v).not.toBe(first.v);
  });
});

describe('ListingsService - live PDP stats', () => {
  it('returns the saved count for a visible listing', async () => {
    const { service } = makeService({ listing: VISIBLE });
    await expect(service.stats('l1')).resolves.toEqual({
      status: 'ACTIVE',
      wishlistCount: 4,
    });
  });

  // Access is ContentAccessGuard's job; the service serves the row and the
  // STATUS gate below is the only visibility rule left here.
  it('serves stats for a members-only listing at the service level', async () => {
    const { service } = makeService({
      listing: { ...VISIBLE, publicVisible: false },
    });
    await expect(service.stats('l1')).resolves.toEqual({
      status: 'ACTIVE',
      wishlistCount: 4,
    });
  });

  it('404s a non-public status for a non-owner member', async () => {
    const { service } = makeService({
      listing: { ...VISIBLE, status: 'DRAFT' },
    });
    await expect(service.stats('l1', 'buyer_9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets the owner read stats on their own draft', async () => {
    const { service } = makeService({
      listing: { ...VISIBLE, status: 'DRAFT' },
    });
    await expect(service.stats('l1', 'seller_1')).resolves.toEqual({
      status: 'DRAFT',
      wishlistCount: 4,
    });
  });

  it('404s an unknown id with the same error as a hidden row', async () => {
    const { service } = makeService({ listing: null });
    await expect(service.stats('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
