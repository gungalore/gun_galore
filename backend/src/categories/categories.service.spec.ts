import { CategoriesService } from './categories.service';

describe('CategoriesService — findBySlugTree', () => {
  let prisma: {
    category: { findUnique: jest.Mock; findMany: jest.Mock };
  };
  let service: CategoriesService;

  beforeEach(() => {
    prisma = { category: { findUnique: jest.fn(), findMany: jest.fn() } };
    service = new CategoriesService(prisma as never);
  });

  it('returns null for an unknown slug', async () => {
    prisma.category.findUnique.mockResolvedValue(null);
    expect(await service.findBySlugTree('nope')).toBeNull();
  });

  it('returns null for an inactive category', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'c1',
      slug: 'x',
      isActive: false,
      parentId: null,
    });
    expect(await service.findBySlugTree('x')).toBeNull();
  });

  it('returns category + parent + active children', async () => {
    const cat = { id: 'c2', slug: 'rifles', isActive: true, parentId: 'p1' };
    const parent = { id: 'p1', slug: 'firearms', isActive: true, parentId: null };
    const children = [
      { id: 'c3', slug: 'bolt-action', isActive: true, parentId: 'c2' },
    ];
    prisma.category.findUnique
      .mockResolvedValueOnce(cat) // slug lookup
      .mockResolvedValueOnce(parent); // parent lookup
    prisma.category.findMany.mockResolvedValue(children);

    // Signed-in member: this test is about the returned tree SHAPE. The
    // signed-out visibility gate has its own spec (public-visibility.spec.ts).
    const tree = await service.findBySlugTree('rifles', 'clerk_member');
    expect(tree).toEqual({ category: cat, parent, children });
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: 'c2', isActive: true } }),
    );
  });

  it('skips the parent lookup for a top-level category', async () => {
    const cat = { id: 'c4', slug: 'optics', isActive: true, parentId: null };
    prisma.category.findUnique.mockResolvedValueOnce(cat);
    prisma.category.findMany.mockResolvedValue([]);

    const tree = await service.findBySlugTree('optics', 'clerk_member');
    expect(tree?.parent).toBeNull();
    expect(prisma.category.findUnique).toHaveBeenCalledTimes(1);
  });
});
