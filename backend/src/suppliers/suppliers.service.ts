import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Province } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

// ─── Daily Deals suppliers service (DD-F) ────────────────────────────
// Admin-only CRUD for the JIT fulfilment suppliers. GG is the first-party
// seller; on a house-deal sale we raise a Zoho Purchase Order against the
// supplier and The Courier Guy collects the stock from its warehouse.
//
// Supplier / cost / PO data is strictly INTERNAL — it is never projected onto
// any public surface (there is no public supplier read). Suppliers are
// soft-deactivated (active=false), never hard-deleted, so historical deals
// keep a resolvable supplier link.
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Validation helpers ────────────────────────────────────────────

  // Normalise a SA phone number to E.164 ("+27..."), mirroring
  // SmsService.normalise so the stored number is dial-ready for the TCG
  // collection contact + Zoho vendor. Throws in domain terms on invalid input.
  private normalisePhone(raw: string): string {
    let n = (raw ?? '').replace(/[\s\-()]/g, '');
    if (n.startsWith('0')) n = '+27' + n.slice(1);
    else if (n.startsWith('27')) n = '+' + n;
    if (!/^\+27\d{9}$/.test(n)) {
      throw new BadRequestException(
        'Supplier phone must be a valid South African mobile number (e.g. 082 123 4567 or +27821234567).',
      );
    }
    return n;
  }

  private assertProvince(province: Province) {
    if (!Object.values(Province).includes(province)) {
      throw new BadRequestException('A valid warehouse province is required.');
    }
  }

  private assertPostalCode(code: string) {
    if (!/^\d{4}$/.test((code ?? '').trim())) {
      throw new BadRequestException(
        'Warehouse postal code must be a 4-digit South African code.',
      );
    }
  }

  // Every warehouse address line must be present + non-blank so TCG always
  // has a collectable origin.
  private assertAddressComplete(a: {
    warehouseStreet?: string;
    warehouseSuburb?: string;
    warehouseCity?: string;
  }) {
    const missing = (['warehouseStreet', 'warehouseSuburb', 'warehouseCity'] as const).filter(
      (k) => !((a[k] ?? '').trim()),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        'A complete warehouse address (street, suburb, city, province, postal code) is required.',
      );
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────

  // Active suppliers first (the pickers the deal builder shows), then the
  // deactivated ones; each block alphabetical.
  async list() {
    return this.prisma.supplier.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async getOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }

  // ── Create ────────────────────────────────────────────────────────
  async create(adminId: string, dto: CreateSupplierDto) {
    this.assertAddressComplete(dto);
    this.assertProvince(dto.warehouseProvince);
    this.assertPostalCode(dto.warehousePostalCode);
    const phone = this.normalisePhone(dto.phone);
    const email = dto.email.trim().toLowerCase();

    const supplier = await this.prisma.supplier.create({
      data: {
        name: dto.name.trim(),
        contactPerson: dto.contactPerson.trim(),
        email,
        phone,
        vatNumber: dto.vatNumber?.trim() || null,
        regNumber: dto.regNumber?.trim() || null,
        warehouseStreet: dto.warehouseStreet.trim(),
        warehouseSuburb: dto.warehouseSuburb.trim(),
        warehouseCity: dto.warehouseCity.trim(),
        warehouseProvince: dto.warehouseProvince,
        warehousePostalCode: dto.warehousePostalCode.trim(),
        warehouseLat: dto.warehouseLat ?? null,
        warehouseLng: dto.warehouseLng ?? null,
        notes: dto.notes?.trim() || null,
        createdByAdminId: adminId,
      },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'SUPPLIER_CREATE',
      resourceType: 'Supplier',
      resourceId: supplier.id,
      newValue: { name: supplier.name, email: supplier.email },
      reason: `Created Daily Deals supplier: ${supplier.name}`,
    });

    return supplier;
  }

  // ── Update ────────────────────────────────────────────────────────
  async update(adminId: string, id: string, dto: UpdateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier not found.');

    // Re-validate every field the PATCH actually carries, and re-check the
    // merged (incoming ?? existing) address so a partial edit can't leave a
    // supplier with an incomplete collection origin.
    const data: Prisma.SupplierUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.contactPerson !== undefined) data.contactPerson = dto.contactPerson.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) data.phone = this.normalisePhone(dto.phone);
    if (dto.vatNumber !== undefined) data.vatNumber = dto.vatNumber?.trim() || null;
    if (dto.regNumber !== undefined) data.regNumber = dto.regNumber?.trim() || null;
    if (dto.warehouseStreet !== undefined) data.warehouseStreet = dto.warehouseStreet.trim();
    if (dto.warehouseSuburb !== undefined) data.warehouseSuburb = dto.warehouseSuburb.trim();
    if (dto.warehouseCity !== undefined) data.warehouseCity = dto.warehouseCity.trim();
    if (dto.warehouseProvince !== undefined) {
      this.assertProvince(dto.warehouseProvince);
      data.warehouseProvince = dto.warehouseProvince;
    }
    if (dto.warehousePostalCode !== undefined) {
      this.assertPostalCode(dto.warehousePostalCode);
      data.warehousePostalCode = dto.warehousePostalCode.trim();
    }
    if (dto.warehouseLat !== undefined) data.warehouseLat = dto.warehouseLat;
    if (dto.warehouseLng !== undefined) data.warehouseLng = dto.warehouseLng;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;

    if (
      dto.warehouseStreet !== undefined ||
      dto.warehouseSuburb !== undefined ||
      dto.warehouseCity !== undefined
    ) {
      this.assertAddressComplete({
        warehouseStreet: dto.warehouseStreet ?? existing.warehouseStreet,
        warehouseSuburb: dto.warehouseSuburb ?? existing.warehouseSuburb,
        warehouseCity: dto.warehouseCity ?? existing.warehouseCity,
      });
    }

    const supplier = await this.prisma.supplier.update({ where: { id }, data });

    await this.audit.record({
      adminUserId: adminId,
      action: 'SUPPLIER_UPDATE',
      resourceType: 'Supplier',
      resourceId: id,
      newValue: dto as unknown,
      reason: `Edited Daily Deals supplier: ${supplier.name}`,
    });

    return supplier;
  }

  // ── Deactivate (soft — never hard-delete) ─────────────────────────
  async deactivate(adminId: string, id: string, reason?: string) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier not found.');
    if (!existing.active) {
      throw new BadRequestException('Supplier is already deactivated.');
    }

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: { active: false },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'SUPPLIER_DEACTIVATE',
      resourceType: 'Supplier',
      resourceId: id,
      oldValue: { active: true },
      newValue: { active: false },
      reason: reason?.trim() || `Deactivated Daily Deals supplier: ${supplier.name}`,
    });

    return supplier;
  }

  // Assert a supplier exists AND is active — used by DealsService when a deal
  // is linked to a supplier (create / update). Returns the supplier row.
  async requireActive(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new BadRequestException('Selected supplier not found.');
    if (!supplier.active) {
      throw new BadRequestException(
        'Selected supplier is deactivated — pick an active supplier.',
      );
    }
    return supplier;
  }
}
