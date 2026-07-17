import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Province } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { canonicaliseLicence } from '../payments/dealer-registry.util';

/**
 * CRUD for the Dealer directory — SAPS-licensed firearm dealers used
 * by checkout to route DEALER_TRANSFER transactions. The directory is
 * admin-managed because every entry needs proof of licence and the
 * operator wants visibility into who's on the network.
 *
 * Soft-delete only: dealers are deactivated (isActive=false), never
 * hard-deleted — transactions reference them historically.
 */

export interface CreateDealerDto {
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string;
  city: string;
  province: Province;
  postalCode: string;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  email?: string | null;
}

export type UpdateDealerDto = Partial<CreateDealerDto> & {
  isActive?: boolean;
  isVerified?: boolean;
};

@Injectable()
export class AdminDealersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(
    search?: string,
    includeInactive = false,
    source?: string,
    pending = false,
  ) {
    // `pending` = the auto-registration review queue: dealers awaiting an
    // admin's eyes (isVerified=false). These are inactive by design, so the
    // pending view ignores the active filter and orders newest-first.
    const where: Record<string, unknown> = pending
      ? { isVerified: false }
      : includeInactive
        ? {}
        : { isActive: true };
    if (source === 'MANUAL' || source === 'AUTO_VERIFICATION') {
      where.source = source;
    }
    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { licenceNumber: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, count, pendingCount] = await Promise.all([
      this.prisma.dealer.findMany({
        where,
        orderBy: pending
          ? [{ createdAt: 'desc' }]
          : [{ isActive: 'desc' }, { name: 'asc' }],
        take: 200,
        include: {
          _count: { select: { transactions: true } },
          // Most-recent linked transfer — lets the admin jump to the dossier
          // (SAP 534 photo) that produced an auto-registered entry.
          transactions: {
            select: { id: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.dealer.count({ where }),
      // Total awaiting review — drives the admin "N pending" badge regardless
      // of the current filter.
      this.prisma.dealer.count({ where: { isVerified: false } }),
    ]);
    return { rows, count, pendingCount };
  }

  async create(adminId: string, dto: CreateDealerDto) {
    if (!dto.name || !dto.licenceNumber || !dto.address) {
      throw new BadRequestException('name, licenceNumber and address are required');
    }
    // Canonicalise the licence to the SAME key form the auto-registration path
    // uses (upper-cased, whitespace-stripped) so a licence typed here with
    // internal spaces can't fork a duplicate of / with the auto directory.
    const licenceNumber = canonicaliseLicence(dto.licenceNumber);
    const existing = await this.prisma.dealer.findUnique({
      where: { licenceNumber },
    });
    if (existing) {
      throw new BadRequestException(
        `A dealer with licence number ${licenceNumber} already exists.`,
      );
    }
    const created = await this.prisma.dealer.create({
      data: {
        name: dto.name.trim(),
        licenceNumber,
        address: dto.address.trim(),
        suburb: dto.suburb,
        city: dto.city,
        province: dto.province,
        postalCode: dto.postalCode,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
      },
    });
    await this.audit.record({
      adminUserId: adminId,
      action: 'DEALER_CREATE',
      resourceType: 'Dealer',
      resourceId: created.id,
      newValue: { name: created.name, licenceNumber: created.licenceNumber },
      reason: `Added new dealer ${created.name} (${created.licenceNumber})`,
    });
    return created;
  }

  async update(adminId: string, id: string, dto: UpdateDealerDto, reason: string) {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 3) {
      throw new BadRequestException(
        'A reason of ≥3 chars is required when editing a dealer.',
      );
    }
    const before = await this.prisma.dealer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Dealer not found');

    const updated = await this.prisma.dealer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.licenceNumber !== undefined ? { licenceNumber: canonicaliseLicence(dto.licenceNumber) } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.suburb !== undefined ? { suburb: dto.suburb } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.province !== undefined ? { province: dto.province } : {}),
        ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
        ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
        ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isVerified !== undefined ? { isVerified: dto.isVerified } : {}),
      },
    });

    // An admin reviewing & verifying an auto-registered dealer (flipping
    // isVerified false→true) is its own audit action so the provenance of
    // the directory is legible.
    const isReviewApproval =
      dto.isVerified === true && !before.isVerified;
    await this.audit.record({
      adminUserId: adminId,
      action: isReviewApproval
        ? 'DEALER_REVIEW_APPROVE'
        : dto.isActive === false
          ? 'DEALER_DEACTIVATE'
          : dto.isActive === true && !before.isActive
            ? 'DEALER_REACTIVATE'
            : 'DEALER_UPDATE',
      resourceType: 'Dealer',
      resourceId: id,
      oldValue: {
        name: before.name,
        isActive: before.isActive,
        isVerified: before.isVerified,
        source: before.source,
      },
      newValue: {
        name: updated.name,
        isActive: updated.isActive,
        isVerified: updated.isVerified,
      },
      reason: trimmedReason,
    });
    return updated;
  }
}
