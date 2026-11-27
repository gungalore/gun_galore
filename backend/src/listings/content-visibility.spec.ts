// Content visibility after the 18+ gate.
//
// The OLD model filtered every public read on `publicVisible`, keyed on whether
// the caller held a session. That model is retired: content no longer varies by
// signed-in state. Access is decided by `ContentAccessGuard` (a member session
// OR a valid `ao_cat` 18+ declaration), and these tests lock the other half of
// the change — the services must NOT quietly reintroduce a publicVisible
// filter, because that would hide half the catalogue from a declared visitor.
//
// The status gates are different and stay: DRAFT / PENDING_MODERATION /
// EXPIRED / removed rows must still 404 for everyone but their owner.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotFoundException } from '@nestjs/common';
import { FeeCalculator } from '../payments/fee.calculator';
import { ListingsService } from './listings.service';
import { CategoriesService } from '../categories/categories.service';

const FIREARM_LISTING = {
  id: 'L1',
  status: 'ACTIVE',
  publicVisible: false,
  seller: { userId: 'SELLER' },
};
const CAMPING_LISTING = {
  id: 'L2',
  status: 'ACTIVE',
  publicVisible: true,
  seller: { userId: 'SELLER' },
};
const EXPIRED_AUCTION = {
  id: 'L3',
  status: 'EXPIRED',
  listingType: 'AUCTION',
  publicVisible: true,
  seller: { userId: 'SELLER' },
};

function makeListings(over: Record<string, unknown> = {}) {
  const prisma = {
    listing: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(over.listing ?? CAMPING_LISTING),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ListingsService(
    prisma as never,
    (over.search ?? { isConnected: false }) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: jest.fn() } as never,
    // Real calculator, not a stub — dependency-free, and it keeps the
    // BUY_NOW markup maths honest wherever a spec touches pricing.
    new FeeCalculator(),
    { resolveByEntity: jest.fn() } as never, // notifications
    { offerAtListingLive: jest.fn().mockResolvedValue(undefined) } as never, // kyc
  );
  return { service, prisma };
}

describe('ListingsService — content no longer varies by sign-in', () => {
  it('browse has no publicVisible filter for an anonymous caller', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ page: 1, limit: 20 } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({ status: 'ACTIVE', isDealListing: false });
    expect(where).not.toHaveProperty('publicVisible');
  });

  it('does NOT restrict the browse for a signed-in member either', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ page: 1, limit: 20 } as never, 'user_123');
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({ status: 'ACTIVE', isDealListing: false });
    expect(where).not.toHaveProperty('publicVisible');
  });

  it('filters a seller storefront through the relation `is` filter Prisma 7 requires', async () => {
    // Prisma 7 rejects `seller: { userId }` with PrismaClientValidationError;
    // every /sellers/[userId] browse returned 500 (production, 2026-11-27).
    const { service, prisma } = makeListings();
    await service.browse({
      page: 1,
      limit: 20,
      sellerId: 'seller_user',
    } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where.seller).toEqual({ is: { userId: 'seller_user' } });
  });

  // ⚠️ The service serves it; the CONTROLLER's ContentAccessGuard is what
  // refuses an un-declared caller. A service-level 404 here would make a
  // declared visitor see an empty catalogue.
  it('serves a members-only listing at the service level', async () => {
    const { service } = makeListings({ listing: FIREARM_LISTING });
    await expect(service.findById('L1')).resolves.toMatchObject({ id: 'L1' });
    await expect(
      service.findById('L1', 'user_someone_else'),
    ).resolves.toMatchObject({ id: 'L1' });
  });

  it('still serves a publicly-flagged listing', async () => {
    const { service } = makeListings({ listing: CAMPING_LISTING });
    await expect(service.findById('L2')).resolves.toMatchObject({ id: 'L2' });
  });

  // The status gate is NOT the content gate and must survive the change.
  it('404s an expired auction for anonymous AND signed-in non-owners', async () => {
    const { service } = makeListings({ listing: EXPIRED_AUCTION });
    await expect(service.findById('L3')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.findById('L3', 'user_someone_else'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-checks ACTIVE (but not publicVisible) when hydrating Meilisearch hits', async () => {
    const search = {
      isConnected: true,
      search: jest.fn().mockResolvedValue({
        hits: [{ id: 'L3' }],
        estimatedTotalHits: 1,
      }),
    };
    const { service, prisma } = makeListings({ search });
    await service.browse({ q: 'inca' } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({
      id: { in: ['L3'] },
      status: 'ACTIVE',
      isDealListing: false,
    });
    expect(where).not.toHaveProperty('publicVisible');
  });

  // A sitemap of gated URLs would be a soft-404 list; the feed is gone.
  it('no longer exposes a sitemap feed', () => {
    const { service } = makeListings();
    expect(
      (service as unknown as { sitemapEntries?: unknown }).sitemapEntries,
    ).toBeUndefined();
  });

  it('folds every brand, for every viewer', async () => {
    const { service, prisma } = makeListings();
    await service.listBrands();
    const where = (prisma.listing.groupBy.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).not.toHaveProperty('publicVisible');
  });

  it('sold comps carry no publicVisible filter', async () => {
    const { service, prisma } = makeListings();
    await service.soldComps({ categorySlug: 'firearms' } as never);
    const where = (prisma.transaction.findMany.mock.calls[0][0] as {
      where: { listing: Record<string, unknown> };
    }).where;
    expect(where.listing).not.toHaveProperty('publicVisible');
  });

  it('browseByIds (recently viewed) carries no publicVisible filter', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ ids: 'a,b,c' } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).not.toHaveProperty('publicVisible');
  });
});

describe('CategoriesService — no signed-out-only tree', () => {
  function makeCategories(over: Record<string, unknown> = {}) {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(over.category ?? null),
      },
      listing: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    return { service: new CategoriesService(prisma as never), prisma };
  }

  it('lists the whole tree regardless of caller', async () => {
    const { service, prisma } = makeCategories();
    await service.findAll();
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('returns a members-only category tree (access is the guard)', async () => {
    const { service } = makeCategories({
      category: {
        id: 'C1',
        slug: 'firearms',
        isActive: true,
        publicVisible: false,
        parentId: null,
      },
    });
    await expect(service.findBySlugTree('firearms')).resolves.toMatchObject({
      category: { slug: 'firearms' },
    });
  });

  it('category counts carry no publicVisible filter', async () => {
    const { service, prisma } = makeCategories();
    await service.withCounts();
    expect(prisma.listing.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ publicVisible: true }),
      }),
    );
  });
});
