import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import {
  CreateCategoryAttributeDto,
  UpdateCategoryAttributeDto,
} from './dto/category-attribute.dto';
import { AttributeType } from '@prisma/client';

/**
 * P4 — CRUD over CategoryAttribute (the per-category DEFINITIONS of which
 * structured specs a category carries). Sits behind the AdminJwtGuard'd
 * AdminCategoryAttributesController.
 *
 * These rows drive the sell form + browse facets, so mutations are audited.
 * Delete is a hard delete (a definition with no dependent listing-value
 * validation yet — P4.2 — is cheap to drop); admins wanting to keep history
 * can instead PATCH isActive=false, which hides it from the effective set.
 */
@Injectable()
export class AdminCategoryAttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // Every attribute defined ON a single category (both active + inactive so
  // the admin UI can toggle them). Does NOT resolve inheritance — that is
  // the public effective-attributes endpoint's job.
  async list(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return this.prisma.categoryAttribute.findMany({
      where: { categoryId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  async create(
    adminId: string,
    categoryId: string,
    dto: CreateCategoryAttributeDto,
  ) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true },
    });
    if (!category) throw new NotFoundException('Category not found');

    // SELECT needs a non-empty option set (belt-and-braces — the DTO also
    // enforces this, but the service is the last line of defence).
    if (dto.type === AttributeType.SELECT && (!dto.options || dto.options.length === 0)) {
      throw new BadRequestException('options must be a non-empty list for SELECT attributes');
    }

    // Reject a duplicate key up-front for a clean 400 instead of a raw
    // Prisma unique-constraint 500 (the DB unique is the real guard).
    const clash = await this.prisma.categoryAttribute.findUnique({
      where: { categoryId_key: { categoryId, key: dto.key } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        `An attribute with key "${dto.key}" already exists on this category.`,
      );
    }

    const created = await this.prisma.categoryAttribute.create({
      data: {
        categoryId,
        key: dto.key,
        label: dto.label.trim(),
        type: dto.type,
        unit: dto.unit?.trim() || null,
        options: dto.type === AttributeType.SELECT ? (dto.options ?? []) : [],
        required: dto.required ?? false,
        filterable: dto.filterable ?? true,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'CATEGORY_ATTRIBUTE_CREATE',
      resourceType: 'CategoryAttribute',
      resourceId: created.id,
      newValue: { categoryId, key: created.key, type: created.type },
      reason: `Added attribute ${created.key} to ${category.name}`,
    });
    return created;
  }

  async update(adminId: string, id: string, dto: UpdateCategoryAttributeDto) {
    const before = await this.prisma.categoryAttribute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Attribute not found');

    // Determine the effective type after this patch so we can validate the
    // SELECT/options invariant against the FINAL state, not just the input.
    const effectiveType = dto.type ?? before.type;
    const effectiveOptions =
      dto.options !== undefined ? dto.options : before.options;
    if (
      effectiveType === AttributeType.SELECT &&
      (!effectiveOptions || effectiveOptions.length === 0)
    ) {
      throw new BadRequestException(
        'options must be a non-empty list for SELECT attributes',
      );
    }

    const updated = await this.prisma.categoryAttribute.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() || null } : {}),
        ...(dto.options !== undefined ? { options: dto.options } : {}),
        ...(dto.required !== undefined ? { required: dto.required } : {}),
        ...(dto.filterable !== undefined ? { filterable: dto.filterable } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: dto.isActive === false ? 'CATEGORY_ATTRIBUTE_DEACTIVATE' : 'CATEGORY_ATTRIBUTE_UPDATE',
      resourceType: 'CategoryAttribute',
      resourceId: id,
      oldValue: {
        label: before.label,
        type: before.type,
        options: before.options,
        isActive: before.isActive,
      },
      newValue: {
        label: updated.label,
        type: updated.type,
        options: updated.options,
        isActive: updated.isActive,
      },
      reason: `Updated attribute ${updated.key}`,
    });
    return updated;
  }

  async remove(adminId: string, id: string) {
    const before = await this.prisma.categoryAttribute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Attribute not found');

    await this.prisma.categoryAttribute.delete({ where: { id } });

    await this.audit.record({
      adminUserId: adminId,
      action: 'CATEGORY_ATTRIBUTE_DELETE',
      resourceType: 'CategoryAttribute',
      resourceId: id,
      oldValue: { categoryId: before.categoryId, key: before.key, type: before.type },
      reason: `Deleted attribute ${before.key}`,
    });
    return { deleted: true, id };
  }
}
