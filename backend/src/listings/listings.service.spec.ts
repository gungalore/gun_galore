// `meilisearch` ships ESM that ts-jest won't transform; SearchService (pulled
// in transitively) only needs the symbol to exist for these unit tests.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ListingsService } from './listings.service';

/**
 * Unit tests for the browse filter wiring + brand facet added in Phase 1.
 * We instantiate the service with light mocks (only Prisma + Search matter
 * for these paths) and drive the public `browse` / `listBrands` methods.
 * With search disconnected, `browse` routes through the Prisma path so we
 * can assert the exact `where` clause it builds.
 */
describe('ListingsService — browse filters & brand facet', () => {
  let prisma: {
    listing: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let service: ListingsService;

  beforeEach(() => {
    prisma = {
      listing: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn(),
      },
    };
    const search = { isConnected: false };
    service = new ListingsService(
      prisma as never,
      search as never,
      {} as never, // cloudinary
      {} as never, // moderation
      {} as never, // settings
      {} as never, // referenceNumbers
      {} as never, // firearmLicence
    );
  });

  it('passes the make filter into the Prisma where clause', async () => {
    await service.browse({ make: 'Glock' } as never);
    expect(prisma.listing.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: 'ACTIVE', make: 'Glock' });
  });

  it('combines make with a price range', async () => {
    await service.browse({
      make: 'CZ',
      minPrice: 100000,
      maxPrice: 500000,
    } as never);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where.make).toBe('CZ');
    expect(arg.where.price).toEqual({ gte: 100000, lte: 500000 });
  });

  it('omits make from the where clause when not supplied', async () => {
    await service.browse({} as never);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where.make).toBeUndefined();
    expect(arg.where).toMatchObject({ status: 'ACTIVE' });
  });

  it('listBrands returns distinct makes (most-listed first), dropping blanks/null', async () => {
    prisma.listing.groupBy.mockResolvedValue([
      { make: 'Glock', _count: { make: 9 } },
      { make: 'CZ', _count: { make: 5 } },
      { make: '   ', _count: { make: 2 } },
      { make: null, _count: { make: 1 } },
    ]);
    const brands = await service.listBrands();
    expect(brands).toEqual(['Glock', 'CZ']);
    const arg = prisma.listing.groupBy.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: 'ACTIVE' });
    expect(arg.orderBy).toEqual({ _count: { make: 'desc' } });
  });
});
