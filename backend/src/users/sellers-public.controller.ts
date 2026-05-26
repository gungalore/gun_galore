import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public seller profile endpoint — powers the /sellers/[clerkId]
 * profile page header (Phase E1 badges + future expansion).
 *
 * Returns only the fields that are explicitly public:
 *   - username, avatarUrl, sellerTier, totalSales, createdAt — all
 *     already exposed via the listing detail seller chip
 *   - subscriptionTier — drives the GG+ pill rendering (OD1 locked)
 *   - isVerifiedExpert + expertBadgeReason — drives the verified-
 *     expert badge with hover tooltip (OD2 locked). The reason is
 *     public because the admin set it as the public-facing
 *     rationale; the private grant-reason lives in AdminAuditEvent.
 *
 * firstName / lastName / email / phone / address / bank fields are
 * deliberately NOT selected — Gun Galore platform policy forbids
 * leaking real names on public surfaces.
 */
@Controller('sellers')
export class SellersPublicController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/sellers/:clerkId
   *
   * Throttled tightly — same enumeration concern as username-check.
   * 30 req/min/IP gives room for the profile page's two-fetch
   * pattern (this + ratings + listings) without inviting scraping.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':clerkId')
  async getSellerProfile(@Param('clerkId') clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        clerkId: true,
        username: true,
        avatarUrl: true,
        sellerTier: true,
        totalSales: true,
        averageRating: true,
        createdAt: true,
        // Phase E1 badges (public by design).
        subscriptionTier: true,
        isVerifiedExpert: true,
        verifiedExpertAt: true,
        expertBadgeReason: true,
      },
    });
    if (!user) throw new NotFoundException('Seller not found');
    return user;
  }
}
