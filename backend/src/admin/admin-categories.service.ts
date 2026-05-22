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
      include: { _count: { select: { listings: true } } },
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

    const created = await this.prisma.category.create({
      data: {
        name,
        slug,
        parentId: dto.parentId ?? null,
        isFirearm: dto.isFirearm ?? false,
        requiresLicence: dto.requiresLicence ?? false,
        availableSecondhand: dto.availableSecondhand ?? true,
        availableNewStore: dto.availableNewStore ?? false,
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
      oldValue: { name: before.name, isActive: before.isActive },
      newValue: { name: updated.name, isActive: updated.isActive },
      reason: trimmedReason,
    });
    return updated;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
