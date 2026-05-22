import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Province } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

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

export type UpdateDealerDto = Partial<CreateDealerDto> & { isActive?: boolean };

@Injectable()
export class AdminDealersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(search?: string, includeInactive = false) {
    const where: Record<string, unknown> = includeInactive ? {} : { isActive: true };
    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { licenceNumber: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, count] = await Promise.all([
      this.prisma.dealer.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        take: 200,
        include: { _count: { select: { transactions: true } } },
      }),
      this.prisma.dealer.count({ where }),
    ]);
    return { rows, count };
  }

  async create(adminId: string, dto: CreateDealerDto) {
    if (!dto.name || !dto.licenceNumber || !dto.address) {
      throw new BadRequestException('name, licenceNumber and address are required');
    }
    const existing = await this.prisma.dealer.findUnique({
      where: { licenceNumber: dto.licenceNumber },
    });
    if (existing) {
      throw new BadRequestException(
        `A dealer with licence number ${dto.licenceNumber} already exists.`,
      );
    }
    const created = await this.prisma.dealer.create({
      data: {
        name: dto.name.trim(),
        licenceNumber: dto.licenceNumber.trim().toUpperCase(),
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
        ...(dto.licenceNumber !== undefined ? { licenceNumber: dto.licenceNumber.trim().toUpperCase() } : {}),
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
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: dto.isActive === false
        ? 'DEALER_DEACTIVATE'
        : dto.isActive === true && !before.isActive
          ? 'DEALER_REACTIVATE'
          : 'DEALER_UPDATE',
      resourceType: 'Dealer',
      resourceId: id,
      oldValue: { name: before.name, isActive: before.isActive },
      newValue: { name: updated.name, isActive: updated.isActive },
      reason: trimmedReason,
    });
    return updated;
  }
}
