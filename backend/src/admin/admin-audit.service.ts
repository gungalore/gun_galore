import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Cross-resource audit logger for every destructive admin action.
// Each call inserts one AdminAuditEvent row. Used by AdminService for
// user mutations (ban / tier / KYC override), and intended to be
// wired into other admin surfaces (transactions, listings, featured
// slot overrides) as they're touched.
//
// Reason is REQUIRED — the service throws if it's missing or empty
// after trimming. The frontend confirmation dialogs collect a reason
// before calling these endpoints; we don't accept actions without
// one.

interface RecordOptions {
  adminUserId: string;
  action: string;            // e.g. 'USER_BAN', 'USER_TIER_CHANGE'
  resourceType?: string;     // e.g. 'User', 'Transaction'
  resourceId?: string;
  oldValue?: unknown;        // anything JSON-serialisable
  newValue?: unknown;
  reason: string;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(opts: RecordOptions): Promise<void> {
    const reason = (opts.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required for this admin action — provide a brief explanation for the audit log.',
      );
    }
    await this.prisma.adminAuditEvent.create({
      data: {
        adminUserId: opts.adminUserId,
        action: opts.action,
        resourceType: opts.resourceType ?? null,
        resourceId: opts.resourceId ?? null,
        oldValue: opts.oldValue === undefined ? null : JSON.stringify(opts.oldValue),
        newValue: opts.newValue === undefined ? null : JSON.stringify(opts.newValue),
        reason,
      },
    });
  }

  // Paginated read for the /admin/audit page. Newest first, optional
  // filter by adminUserId or resourceType.
  async list(opts: {
    limit?: number;
    offset?: number;
    adminUserId?: string;
    resourceType?: string;
  }) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where = {
      ...(opts.adminUserId ? { adminUserId: opts.adminUserId } : {}),
      ...(opts.resourceType ? { resourceType: opts.resourceType } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          adminUser: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.adminAuditEvent.count({ where }),
    ]);
    return { rows, total, limit, offset };
  }
}
