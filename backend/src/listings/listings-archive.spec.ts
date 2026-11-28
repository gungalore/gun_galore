import { ListingsService } from './listings.service';

// Focused unit test for the seller-list filters. The service has a large
// dependency graph, so the prototype is used with only the two Prisma
// delegates these read methods touch — the same pattern the older focused
// specs use for narrow methods.
describe('ListingsService — seller archive', () => {
  function serviceWithPrisma(prisma: unknown): ListingsService {
    const svc = Object.create(ListingsService.prototype) as ListingsService;
    (svc as unknown as { prisma: unknown }).prisma = prisma;
    return svc;
  }

  const user = { id: 'seller-1' };
  const rows = [{ id: 'l1' }];

  it('findMine excludes removed and expired listings from the working list', async () => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const svc = serviceWithPrisma({
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      listing: { findMany },
    });

    await expect(svc.findMine('seller-1')).resolves.toEqual(rows);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sellerId: 'seller-1',
          archivedAt: null,
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        }),
      }),
    );
  });

  it('findMineArchive returns only cancelled/expired rows, with the admin reason', async () => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const svc = serviceWithPrisma({
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      listing: { findMany },
    });

    await expect(svc.findMineArchive('seller-1')).resolves.toEqual(rows);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      sellerId: 'seller-1',
      status: { in: ['CANCELLED', 'EXPIRED'] },
    });
    expect(args.select.adminOverrideReason).toBe(true);
    expect(args.select.images).toBeDefined();
  });

  it('returns an empty archive for an unknown seller', async () => {
    const findMany = jest.fn();
    const svc = serviceWithPrisma({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      listing: { findMany },
    });

    await expect(svc.findMineArchive('missing')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
