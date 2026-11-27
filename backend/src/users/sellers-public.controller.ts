import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';

/**
 * Public seller profile endpoint — powers the /sellers/[userId]
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
 * deliberately NOT selected — ALL Outdoor platform policy forbids
 * leaking real names on public surfaces.
 *
 * ⚠️ NEVER select the `closure` relation (AccountClosure) here. It holds
 * the released email / phone / real name of a departed member in the clear
 * for admin and law-enforcement use only.
 */
@Controller('sellers')
// The seller storefront is content: behind the 18+ gate, identical for a
// declared visitor and a member. Without the content guard this endpoint was
// a side door around the gate for anyone who could type a URL.
@UseGuards(OptionalAuthGuard, ContentAccessGuard)
export class SellersPublicController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/sellers/:userId
   *
   * Throttled tightly — same enumeration concern as username-check.
   * 30 req/min/IP gives room for the profile page's two-fetch
   * pattern (this + ratings + listings) without inviting scraping.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':userId')
  async getSellerProfile(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        // A closed account has no public profile. The closure scrubs the row,
        // and this is the half that holds regardless of what the scrub did:
        // the identity-provider delete and its webhook are steps 3 and 4 of the closure,
        // both outside the DB transaction, so between the member clicking
        // Close and the webhook arriving the row still carries its real
        // userId. Without this line every /sellers/<userId> link the member
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
        // Identity-verified trust signal. We expose ONLY booleans - never
        // the SA ID, name, or any KYC detail. A yes/no tick, no PII.
        kycStatus: true,
        kycIdVerifiedAt: true,
        phoneVerified: true,
        emailVerifiedAt: true,
        /**
         * ⚠️ THE REAL REVIEW COUNT, NOT `recentRatings.length`. The storefront
         * renders the cached `averageRating` beside this number; the public
         * ratings endpoint is capped at the 50 most recent rows, so counting the
         * list would under-report a long-lived seller and make "4.8 from 11
         * buyers" wrong the moment they pass the cap.
         */
        _count: { select: { ratingsReceived: true } },
      },
    });
    if (!user) throw new NotFoundException('Seller not found');
    const {
      kycStatus,
      kycIdVerifiedAt,
      phoneVerified,
      emailVerifiedAt,
      _count,
      ...rest
    } = user;
    return {
      ...rest,
      idVerified: kycStatus === 'VERIFIED',
      verification: {
        phoneVerified,
        emailVerified: emailVerifiedAt != null,
        idVerified: kycIdVerifiedAt != null,
      },
      totalRatings: _count?.ratingsReceived ?? 0,
    };
  }
}
