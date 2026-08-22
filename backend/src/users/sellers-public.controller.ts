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
 * deliberately NOT selected — All Outdoor platform policy forbids
 * leaking real names on public surfaces.
 *
 * ⚠️ NEVER select the `closure` relation (AccountClosure) here. It holds
 * the released email / phone / real name of a departed member in the clear
 * for admin and law-enforcement use only.
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
      where: {
        clerkId,
        // A closed account has no public profile. This is belt-and-braces on
        // top of the `clerkId` tombstone the closure writes (closed_<userId>),
        // and it is the half that holds when the tombstone has not landed:
        // the Clerk delete and its webhook are steps 3 and 4 of the closure,
        // both outside the DB transaction, so between the member clicking
        // Close and the webhook arriving the row still carries its real
        // clerkId. Without this line every /sellers/<clerkId> link the member
        // ever shared keeps serving their storefront header — sellerTier,
        // totalSales, averageRating and the idVerified tick — through that
        // window, and forever if the webhook is lost.
        //
        // The profile 404 is also what retires the verification badge: every
        // KYC column survives closure by design (SAP 534 Section C is
        // assembled live off this row), so `idVerified` below would otherwise
        // keep asserting a checked identity for an account that no longer
        // exists.
        accountClosedAt: null,
      },
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
        // Identity-verified trust signal. We expose ONLY the boolean
        // (kycStatus === VERIFIED) as `idVerified` — never the SA ID,
        // name, or any KYC detail. A yes/no tick, no PII.
        kycStatus: true,
      },
    });
    if (!user) throw new NotFoundException('Seller not found');
    const { kycStatus, ...rest } = user;
    return { ...rest, idVerified: kycStatus === 'VERIFIED' };
  }
}
