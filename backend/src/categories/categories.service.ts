import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Category, CategoryAttribute } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Every ACTIVE category with a ROLLED-UP active-listing count: a parent's
   * count = its own direct listings + all its children's. Listings are filed
   * on leaf categories, so a parent's direct count is normally 0 and its real
   * total comes entirely from its children.
   *
   * Efficient: one groupBy over Listing.categoryId (ACTIVE only) + the existing
   * category list, then a single roll-up pass — no N+1. Powers homepage tiles
   * and facet counts.
   */
  async withCounts(): Promise<
    Array<
      Pick<Category, 'id' | 'name' | 'slug' | 'parentId' | 'isActive' | 'sortOrder'> & {
        count: number;
      }
    >
  > {
    const [categories, grouped] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.listing.groupBy({
        by: ['categoryId'],
        // Exclude Daily Deals so house deals don't inflate the public
        // per-category counts on the homepage tiles + filter facets.
        where: { status: 'ACTIVE', isDealListing: false },
        _count: { _all: true },
      }),
    ]);

    // Direct (leaf) active-listing count per categoryId.
    const directCount = new Map<string, number>();
    for (const g of grouped) {
      directCount.set(g.categoryId, g._count._all);
    }

    // Roll up: each category's total = its own direct count + the sum of its
    // children's direct counts. The tree is 2-level (root + children), so a
    // single pass adding each child's direct count to its parent suffices.
    const rolledUp = new Map<string, number>();
    for (const c of categories) {
      rolledUp.set(c.id, directCount.get(c.id) ?? 0);
    }
    for (const c of categories) {
      if (c.parentId && rolledUp.has(c.parentId)) {
        rolledUp.set(
          c.parentId,
          (rolledUp.get(c.parentId) ?? 0) + (directCount.get(c.id) ?? 0),
        );
      }
    }

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      count: rolledUp.get(c.id) ?? 0,
    }));
  }

  async findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  async findBySlug(slug: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { slug } });
  }

  /**
   * A category plus the context a public landing page needs: its parent (for
   * the breadcrumb) and its active children (for subcategory drill-down).
   * Returns null when the slug doesn't exist so the controller can 404.
   */
  async findBySlugTree(slug: string): Promise<{
    category: Category;
    parent: Category | null;
    children: Category[];
  } | null> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive) return null;
    const [parent, children] = await Promise.all([
      category.parentId
        ? this.prisma.category.findUnique({ where: { id: category.parentId } })
        : Promise.resolve(null),
      this.prisma.category.findMany({
        where: { parentId: category.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return { category, parent, children };
  }

  /**
   * P4 — the EFFECTIVE attribute set for a category: its own ACTIVE
   * attributes PLUS every ANCESTOR category's ACTIVE attributes, deduped by
   * `key` with the NEAREST category winning (a leaf's own attr overrides an
   * inherited one of the same key).
   *
   * Walks up parentId in a loop so it handles arbitrary tree depth (today's
   * tree is 2-level: leaf + its root, but the loop is depth-agnostic). A
   * visited-set guards against a malformed cycle. Result is sorted by
   * (ancestor-distance ASC, sortOrder ASC) so the leaf's own attributes
   * surface first, then each inherited level in turn.
   *
   * Returns [] for an unknown categoryId (no throw — the sell form treats
   * "no attributes" and "unknown category" identically).
   */
  async getEffectiveAttributes(categoryId: string): Promise<CategoryAttribute[]> {
    // Walk the ancestor chain, recording each category's distance from the
    // requested leaf (0 = the leaf itself). Bounded loop + visited-set so a
    // bad parentId cycle can't spin forever.
    const distanceById = new Map<string, number>();
    let currentId: string | null = categoryId;
    let distance = 0;
    while (currentId && !distanceById.has(currentId)) {
      const node: { id: string; parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId },
          select: { id: true, parentId: true },
        });
      if (!node) break;
      distanceById.set(node.id, distance);
      currentId = node.parentId;
      distance += 1;
    }

    if (distanceById.size === 0) return [];

    const attributes = await this.prisma.categoryAttribute.findMany({
      where: {
        categoryId: { in: Array.from(distanceById.keys()) },
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }],
    });

    // Dedupe by key — nearest category (smallest distance) wins.
    const byKey = new Map<string, CategoryAttribute>();
    for (const attr of attributes) {
      const existing = byKey.get(attr.key);
      if (
        !existing ||
        (distanceById.get(attr.categoryId) ?? Infinity) <
          (distanceById.get(existing.categoryId) ?? Infinity)
      ) {
        byKey.set(attr.key, attr);
      }
    }

    // Sort: leaf-first (ancestor distance), then the category's own sortOrder.
    return Array.from(byKey.values()).sort((a, b) => {
      const da = distanceById.get(a.categoryId) ?? Infinity;
      const db = distanceById.get(b.categoryId) ?? Infinity;
      if (da !== db) return da - db;
      return a.sortOrder - b.sortOrder;
    });
  }
}
