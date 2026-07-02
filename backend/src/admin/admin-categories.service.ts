import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * CRUD over Category. Tree-structured (parentId). Operations:
 *   - list (returns the whole tree, including inactive — frontend
 *     toggles visibility)
 *   - create (under a parent or top-level)
 *   - update (rename, toggle isActive, change sortOrder, flip
 *     isFirearm / requiresLicence / availableSecondhand /
 *     availableNewStore flags)
 *
 * No hard-delete — categories have listings tied to them, so we
 * deactivate (`isActive = false`) instead. Inactive categories don't
 * appear in marketplace filters or the Sell form, but historical
 * listings keep their reference.
 */

export interface CreateCategoryDto {
  name: string;
  parentId?: string | null;
  isFirearm?: boolean;
  requiresLicence?: boolean;
  availableSecondhand?: boolean;
  availableNewStore?: boolean;
  crossSellEligible?: boolean;
  sortOrder?: number;
}

export type UpdateCategoryDto = Partial<CreateCategoryDto> & {
  isActive?: boolean;
};

@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // Full tree, including inactive. Frontend can filter visually if it
  // wants to show only active.
  async list() {
    const all = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { listings: true } },
        // Cross-sell complements (the "to" categories) so the admin UI can
        // prefill the relationship picker.
        crossSellTo: {
          select: { toCategoryId: true, requireExactMatch: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return all;
  }

  async create(adminId: string, dto: CreateCategoryDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Category name required');
    // Slug = lowercased name with non-alphanumeric → dash, dedupe
    // boundaries. If a collision occurs, append a numeric suffix.
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (await this.prisma.category.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    // P0.1b (FCA) — a subcategory INHERITS the parent's compliance flags
    // unless the admin explicitly sets them. Previously isFirearm /
    // requiresLicence defaulted to false, so a child added under
    // "Firearms" silently skipped licence verification + dealer transfer.
    let parent: { isFirearm: boolean; requiresLicence: boolean } | null = null;
    if (dto.parentId) {
      parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
        select: { isFirearm: true, requiresLicence: true },
      });
      if (!parent) throw new BadRequestException('Parent category not found');
    }

    const created = await this.prisma.category.create({
      data: {
        name,
        slug,
        parentId: dto.parentId ?? null,
        isFirearm: dto.isFirearm ?? parent?.isFirearm ?? false,
        requiresLicence: dto.requiresLicence ?? parent?.requiresLicence ?? false,
        availableSecondhand: dto.availableSecondhand ?? true,
        availableNewStore: dto.availableNewStore ?? false,
        crossSellEligible: dto.crossSellEligible ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'CATEGORY_CREATE',
      resourceType: 'Category',
      resourceId: created.id,
      newValue: { name: created.name, slug: created.slug, parentId: created.parentId },
      reason: `Created category ${created.name}`,
    });
    return created;
  }

  async update(adminId: string, id: string, dto: UpdateCategoryDto, reason: string) {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 3) {
      throw new BadRequestException(
        'A reason of ≥3 chars is required when editing a category.',
      );
    }
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');

    // P0.1b (FCA) — flipping the firearm flag changes the gating of every
    // FUTURE listing in this category (existing listings keep their
    // create-time snapshot). Surface the blast radius in the audit trail.
    let activeListingsAtFlip: number | null = null;
    if (dto.isFirearm !== undefined && dto.isFirearm !== before.isFirearm) {
      activeListingsAtFlip = await this.prisma.listing.count({
        where: { categoryId: id, status: 'ACTIVE' },
      });
    }

    // Renaming = also re-slug (with collision suffix) so the public
    // URL stays in sync. We keep old slug data only if name unchanged.
    let newSlug: string | undefined;
    if (dto.name && dto.name.trim() && dto.name.trim() !== before.name) {
      const base = slugify(dto.name.trim());
      newSlug = base;
      let suffix = 1;
      while (true) {
        const existing = await this.prisma.category.findUnique({ where: { slug: newSlug } });
        if (!existing || existing.id === id) break;
        newSlug = `${base}-${suffix}`;
        suffix += 1;
      }
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(newSlug !== undefined ? { slug: newSlug } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.isFirearm !== undefined ? { isFirearm: dto.isFirearm } : {}),
        ...(dto.requiresLicence !== undefined ? { requiresLicence: dto.requiresLicence } : {}),
        ...(dto.availableSecondhand !== undefined ? { availableSecondhand: dto.availableSecondhand } : {}),
        ...(dto.availableNewStore !== undefined ? { availableNewStore: dto.availableNewStore } : {}),
        ...(dto.crossSellEligible !== undefined ? { crossSellEligible: dto.crossSellEligible } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: dto.isActive === false
        ? 'CATEGORY_DEACTIVATE'
        : dto.isActive === true && !before.isActive
          ? 'CATEGORY_REACTIVATE'
          : 'CATEGORY_UPDATE',
      resourceType: 'Category',
      resourceId: id,
      oldValue: {
        name: before.name,
        isActive: before.isActive,
        crossSellEligible: before.crossSellEligible,
        isFirearm: before.isFirearm,
      },
      newValue: {
        name: updated.name,
        isActive: updated.isActive,
        crossSellEligible: updated.crossSellEligible,
        isFirearm: updated.isFirearm,
        ...(activeListingsAtFlip !== null
          ? { activeListingsAtFirearmFlip: activeListingsAtFlip }
          : {}),
      },
      reason: trimmedReason,
    });
    return updated;
  }

  /**
   * Replace a category's cross-sell complementary set ("when browsing
   * THIS category, also suggest these"). Preserves the requireExactMatch
   * (calibre-hard) flag on relations that survive the edit — so the
   * seeded reloading matches aren't lost — and defaults new links to a
   * soft match. Self-references + unknown/duplicate targets are dropped.
   */
  async setRelations(
    adminId: string,
    fromCategoryId: string,
    toCategoryIds: string[],
    reason: string,
  ) {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 3) {
      throw new BadRequestException(
        'A reason of ≥3 chars is required when editing cross-sell links.',
      );
    }
    const from = await this.prisma.category.findUnique({
      where: { id: fromCategoryId },
      include: { crossSellTo: true },
    });
    if (!from) throw new NotFoundException('Category not found');

    const wanted = Array.from(
      new Set((toCategoryIds ?? []).filter((t) => t && t !== fromCategoryId)),
    );
    const existing = wanted.length
      ? await this.prisma.category.findMany({
          where: { id: { in: wanted } },
          select: { id: true },
        })
      : [];
    const validIds = new Set(existing.map((c) => c.id));
    const finalIds = wanted.filter((t) => validIds.has(t));

    const prevByTo = new Map(
      from.crossSellTo.map((r) => [r.toCategoryId, r.requireExactMatch]),
    );
    const before = from.crossSellTo.map((r) => r.toCategoryId);

    await this.prisma.$transaction(async (tx) => {
      await tx.categoryRelation.deleteMany({ where: { fromCategoryId } });
      if (finalIds.length > 0) {
        await tx.categoryRelation.createMany({
          data: finalIds.map((toCategoryId, i) => ({
            fromCategoryId,
            toCategoryId,
            sortOrder: i,
            requireExactMatch: prevByTo.get(toCategoryId) ?? false,
          })),
        });
      }
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'CATEGORY_RELATIONS_SET',
      resourceType: 'Category',
      resourceId: fromCategoryId,
      oldValue: { toCategoryIds: before },
      newValue: { toCategoryIds: finalIds },
      reason: trimmedReason,
    });
    return { fromCategoryId, toCategoryIds: finalIds };
  }

  /**
   * "Unmet demand" report — cross-sell lookups that returned nothing,
   * aggregated by category + normalised calibre, most-wanted first. Tells
   * the operator exactly which complementary stock to recruit.
   */
  async crossSellDemand() {
    const misses = await this.prisma.crossSellMiss.findMany({
      orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }],
      take: 100,
    });
    const ids = Array.from(new Set(misses.map((m) => m.fromCategoryId)));
    const cats = ids.length
      ? await this.prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(cats.map((c) => [c.id, c.name]));
    return misses.map((m) => ({
      fromCategoryId: m.fromCategoryId,
      fromCategoryName: nameById.get(m.fromCategoryId) ?? '(removed category)',
      calibre: m.calibre,
      count: m.count,
      lastSeenAt: m.lastSeenAt,
    }));
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
