// The members-only visibility gate.
//
// Everything else in this change (SEO, sitemap, metadata, copy) is
// presentation. THIS is the layer that actually decides what a signed-out
// visitor — or Meta's crawler — can retrieve, and every one of these tests
// describes a way the site previously handed firearm data to anonymous callers.
//
// The rule under test is always the same: no verified Clerk id ⇒ publicVisible
// only. Never a user-agent check, never a header — serving a crawler something
// different from a logged-out human is cloaking, and would make the block worse.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotFoundException } from '@nestjs/common';
import { FeeCalculator } from '../payments/fee.calculator';
import { ListingsService } from './listings.service';
import { CategoriesService } from '../categories/categories.service';

const FIREARM_LISTING = {
  id: 'L1',
  status: 'ACTIVE',
  publicVisible: false,
  seller: { clerkId: 'SELLER' },
};
const CAMPING_LISTING = {
  id: 'L2',
  status: 'ACTIVE',
  publicVisible: true,
  seller: { clerkId: 'SELLER' },
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
    { isConnected: false } as never,
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
  );
  return { service, prisma };
}

describe('ListingsService — signed-out visibility gate', () => {
  // ── browse (Prisma path) ────────────────────────────────────────
  it('adds publicVisible to the browse WHERE for an anonymous caller', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ page: 1, limit: 20 } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({
      status: 'ACTIVE',
      isDealListing: false,
      publicVisible: true,
    });
  });

  it('does NOT restrict the browse for a signed-in member', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ page: 1, limit: 20 } as never, 'clerk_123');
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).not.toHaveProperty('publicVisible');
    // The pre-existing chokepoint must survive untouched.
    expect(where).toMatchObject({ status: 'ACTIVE', isDealListing: false });
  });

  // ── findById — the direct-probe path ────────────────────────────
  it('404s a members-only listing for an anonymous caller', async () => {
    const { service } = makeListings({ listing: FIREARM_LISTING });
    await expect(service.findById('L1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves the same members-only listing to a signed-in NON-owner', async () => {
    const { service } = makeListings({ listing: FIREARM_LISTING });
    // Every member sees the full catalogue — the gate keys on having a
    // session, not on owning the listing.
    await expect(service.findById('L1', 'clerk_someone_else')).resolves.toMatchObject(
      { id: 'L1' },
    );
  });

  it('still serves a publicly-visible listing anonymously', async () => {
    const { service } = makeListings({ listing: CAMPING_LISTING });
    await expect(service.findById('L2')).resolves.toMatchObject({ id: 'L2' });
  });

  // ── the crawler-facing feed ─────────────────────────────────────
  it('sitemap entries are publicVisible-only with NO signed-in variant', async () => {
    const { service, prisma } = makeListings();
    await service.sitemapEntries();
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    // A sitemap is read by crawlers by definition, so this one is
    // unconditional — it must not depend on a caller identity at all.
    expect(where).toMatchObject({ status: 'ACTIVE', publicVisible: true });
  });

  // ── brand folding: firearm makes must not become public brand pages ──
  it('folds brands over publicVisible listings only when anonymous', async () => {
    const { service, prisma } = makeListings();
    await service.listBrands();
    const where = (prisma.listing.groupBy.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({ publicVisible: true });
  });

  it('folds every brand for a signed-in member', async () => {
    const { service, prisma } = makeListings();
    await service.listBrands(60, 'clerk_123');
    const where = (prisma.listing.groupBy.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).not.toHaveProperty('publicVisible');
  });

  // ── realised sale prices ────────────────────────────────────────
  it('excludes members-only sales from anonymous sold-comps', async () => {
    const { service, prisma } = makeListings();
    await service.soldComps({ categorySlug: 'firearms' });
    const where = (prisma.transaction.findMany.mock.calls[0][0] as {
      where: { listing: Record<string, unknown> };
    }).where;
    expect(where.listing).toMatchObject({ publicVisible: true });
  });

  // ── recently-viewed rail: ids survive sign-out in localStorage ───
  it('gates browseByIds so the recently-viewed rail cannot resurface a gated item', async () => {
    const { service, prisma } = makeListings();
    await service.browse({ ids: 'a,b,c' } as never);
    const where = (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({ publicVisible: true });
  });
});

describe('CategoriesService — signed-out visibility gate', () => {
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

  it('lists only public categories anonymously', async () => {
    const { service, prisma } = makeCategories();
    await service.findAll();
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, publicVisible: true },
      }),
    );
  });

  it('lists the whole tree for a member', async () => {
    const { service, prisma } = makeCategories();
    await service.findAll('clerk_123');
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  // A members-only slug must be indistinguishable from a bad slug.
  it('returns null for a members-only slug probed anonymously', async () => {
    const { service } = makeCategories({
      category: { id: 'C1', slug: 'firearms', isActive: true, publicVisible: false },
    });
    await expect(service.findBySlugTree('firearms')).resolves.toBeNull();
  });

  it('returns the tree for that slug to a member', async () => {
    const { service } = makeCategories({
      category: {
        id: 'C1',
        slug: 'firearms',
        isActive: true,
        publicVisible: false,
        parentId: null,
      },
    });
    await expect(
      service.findBySlugTree('firearms', 'clerk_123'),
    ).resolves.toMatchObject({ category: { slug: 'firearms' } });
  });

  it('excludes members-only listings from anonymous category counts', async () => {
    const { service, prisma } = makeCategories();
    await service.withCounts();
    expect(prisma.listing.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ publicVisible: true }),
      }),
    );
  });
});
