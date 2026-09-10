import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// User-initiated reports (Phase 3). Reuses the existing AdminAlert channel
// (type = LISTING_REPORTED | SELLER_REPORTED) so they land in the admin
// trust-safety queue alongside contact-detail rejections and reported Q&A.
// No new table needed.

const REASONS = [
  'prohibited',
  'suspicious',
  'scam',
  'counterfeit',
  'other',
] as const;
type Reason = (typeof REASONS)[number];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(reason?: string): { reason: Reason; comment: string } {
    const r = (reason ?? '').trim().toLowerCase();
    const matched = (REASONS as readonly string[]).includes(r)
      ? (r as Reason)
      : 'other';
    // Allow a short free-text note too (sent as the same field); cap length.
    return { reason: matched, comment: (reason ?? '').slice(0, 500) };
  }

  private async reporterId(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  async reportListing(
    listingId: string,
    reporterId: string,
    reason?: string,
    note?: string,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    const reporter = await this.reporterId(reporterId);
    const { reason: r } = this.clean(reason);
    await this.prisma.adminAlert.create({
      data: {
        type: 'LISTING_REPORTED',
        referenceId: listingId,
        context: JSON.stringify({
          reason: r,
          note: (note ?? '').slice(0, 500) || undefined,
          reporterId: reporter,
        }),
      },
    });
    return { reported: true };
  }

  async reportSeller(
    sellerId: string,
    reporterId: string,
    reason?: string,
    note?: string,
  ) {
    if (sellerId === reporterId) {
      throw new BadRequestException('You cannot report yourself');
    }
    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const reporter = await this.reporterId(reporterId);
    const { reason: r } = this.clean(reason);
    await this.prisma.adminAlert.create({
      data: {
        type: 'SELLER_REPORTED',
        referenceId: seller.id,
        context: JSON.stringify({
          reason: r,
          note: (note ?? '').slice(0, 500) || undefined,
          reporterId: reporter,
          sellerId,
        }),
      },
    });
    return { reported: true };
  }
}
