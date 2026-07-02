// NotificationsService/PushService are pulled in transitively for the
// constructor types; guard meilisearch (ESM) in case the import chain reaches
// it, matching the other service specs.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { SavedSearchesService } from './saved-searches.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';

function makeService(over: {
  existing?: unknown;
  count?: number;
  searches?: unknown[];
  matches?: unknown[];
}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
    savedSearch: {
      findUnique: jest.fn().mockResolvedValue(over.existing ?? null),
      count: jest.fn().mockResolvedValue(over.count ?? 0),
      upsert: jest.fn(
        async (args: {
          where: { userId_fingerprint: { fingerprint: string } };
          create: Record<string, unknown>;
        }) => ({
          id: 'ss1',
          createdAt: new Date('2020-01-01'),
          ...args.create,
        }),
      ),
      findMany: jest.fn().mockResolvedValue(over.searches ?? []),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    listing: { findMany: jest.fn().mockResolvedValue(over.matches ?? []) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const notifications = { persist: jest.fn().mockResolvedValue(undefined) };
  const push = { sendToUser: jest.fn().mockResolvedValue(1) };
  const svc = new SavedSearchesService(
    prisma as never,
    notifications as never,
    push as never,
  );
  return { svc, prisma, notifications, push };
}

const baseSearch = {
  id: 'ss1',
  userId: 'u1',
  label: null,
  q: null,
  categoryId: null,
  categorySlug: null,
  listingType: null,
  condition: null,
  province: null,
  make: 'Toyota',
  minPrice: null,
  maxPrice: null,
  sort: null,
  attrs: null,
  fingerprint: 'f',
  notifyEnabled: true,
  lastNotifiedAt: null,
  createdAt: new Date('2020-01-01'),
};

describe('SavedSearchesService', () => {
  it('rejects an empty save (no filters = "alert me on everything")', async () => {
    const { svc } = makeService({});
    await expect(svc.create('c1', {} as CreateSavedSearchDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fingerprints ignore sort/label — re-saving the same filters is idempotent', async () => {
    const { svc, prisma } = makeService({});
    await svc.create('c1', { q: 'hilux', make: 'Toyota' } as CreateSavedSearchDto);
    await svc.create('c1', {
      make: 'Toyota',
      q: 'hilux',
      sort: 'price_asc',
      label: 'My rig',
    } as CreateSavedSearchDto);
    const fp1 = prisma.savedSearch.upsert.mock.calls[0][0].where.userId_fingerprint
      .fingerprint;
    const fp2 = prisma.savedSearch.upsert.mock.calls[1][0].where.userId_fingerprint
      .fingerprint;
    expect(fp1).toBe(fp2);
  });

  it('different filters produce different fingerprints', async () => {
    const { svc, prisma } = makeService({});
    await svc.create('c1', { q: 'engel' } as CreateSavedSearchDto);
    await svc.create('c1', { q: 'national luna' } as CreateSavedSearchDto);
    const fpA = prisma.savedSearch.upsert.mock.calls[0][0].where.userId_fingerprint
      .fingerprint;
    const fpB = prisma.savedSearch.upsert.mock.calls[1][0].where.userId_fingerprint
      .fingerprint;
    expect(fpA).not.toBe(fpB);
  });

  it('enforces the per-user cap only for a genuinely new search', async () => {
    const { svc } = makeService({ existing: null, count: 50 });
    await expect(
      svc.create('c1', { q: 'x' } as CreateSavedSearchDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matchAndNotify notifies + pushes + advances the cursor on a match', async () => {
    const { svc, prisma, notifications, push } = makeService({
      searches: [baseSearch],
      matches: [{ id: 'L1' }],
    });
    const res = await svc.matchAndNotify();

    expect(notifications.persist).toHaveBeenCalledTimes(1);
    expect(notifications.persist.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      type: 'saved_search_match',
      dismissible: true,
      linkedType: 'listing',
      linkedId: 'L1',
    });
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(prisma.savedSearch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ss1' },
        data: expect.objectContaining({ lastNotifiedAt: expect.any(Date) }),
      }),
    );
    expect(res.notified).toBe(1);

    // Match query excludes the owner's own listings + only ACTIVE.
    const where = prisma.listing.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
    expect(where.sellerId).toEqual({ not: 'u1' });
    expect(where.make).toBe('Toyota');
    // Time window keyed on listedAt (when first ACTIVE), NOT createdAt — with a
    // createdAt fallback for legacy rows whose listedAt is null.
    const timeOr = (where.AND as { OR: unknown[] }[])[0].OR;
    expect(timeOr).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listedAt: expect.objectContaining({ gt: baseSearch.createdAt }),
        }),
        expect.objectContaining({
          listedAt: null,
          createdAt: expect.objectContaining({ gt: baseSearch.createdAt }),
        }),
      ]),
    );
  });

  it('skips a freshly-created search still inside the commit-safety margin', async () => {
    // cursor = createdAt = now, which is >= cutoff (now - 30s) → skip, no query,
    // no cursor advance (so it isn't moved backwards).
    const fresh = { ...baseSearch, createdAt: new Date(), lastNotifiedAt: null };
    const { svc, prisma } = makeService({
      searches: [fresh],
      matches: [{ id: 'L1' }],
    });
    await svc.matchAndNotify();
    expect(prisma.listing.findMany).not.toHaveBeenCalled();
    expect(prisma.savedSearch.update).not.toHaveBeenCalled();
  });

  it('matchAndNotify advances the cursor but does NOT notify when there are no matches', async () => {
    const { svc, prisma, notifications, push } = makeService({
      searches: [baseSearch],
      matches: [],
    });
    await svc.matchAndNotify();

    expect(notifications.persist).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
    // Cursor still advances — we've inspected everything up to now.
    expect(prisma.savedSearch.update).toHaveBeenCalledTimes(1);
  });
});
