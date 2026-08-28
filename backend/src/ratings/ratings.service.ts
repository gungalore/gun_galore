import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SellerTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { CreateRatingDto } from './dto/create-rating.dto';

// Buyers may correct a rating for this long after submitting (fat-finger
// insurance) — the window closes EARLY if the seller has already replied,
// so an exchange can never be rewritten out from under a response.
const EDIT_WINDOW_DAYS = 30;

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  async create(transactionId: string, buyerClerkId: string, dto: CreateRatingDto) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, seller: true, rating: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    // Synthetic swap money rows (settlement/refund) are accounting records,
    // not purchases — rating through one produced a weird one-sided review
    // path. Proper two-way swap ratings are a future feature.
    if (tx.swapId)
      throw new BadRequestException('Swap ratings are not supported yet.');
    if (tx.buyer.clerkId !== buyerClerkId) throw new ForbiddenException('Only the buyer can rate');
    if (tx.rating) throw new ConflictException('Transaction already has a rating');
    if (tx.paymentStatus !== 'RELEASED')
      throw new BadRequestException('Can only rate after payment has been released');

    // Rating comments are public on the seller's profile, so a contact
    // detail in a comment routes around platform fees identically to a
    // note-to-seller. Block before the DB write.
    if (dto.comment) {
      const check = await this.contactFilter.check(
        dto.comment,
        'rating-comment',
        buyerClerkId,
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    const rating = await this.prisma.rating.create({
      data: {
        transactionId,
        raterId: tx.buyerId,
        ratedId: tx.sellerId,
        stars: dto.stars,
        comment: dto.comment ?? null,
      },
    });

    // Recalculate seller trust score and tier
    await this.recalcSeller(tx.sellerId);

    // Tell the seller — a 1–2★ deserves the phone buzz so they can
    // respond quickly; 3–5★ stays inbox/email. Template methods never
    // throw, so fire-and-forget is safe.
    void this.notifications.ratingReceived({
      email: tx.seller.email,
      name: tx.seller.firstName ?? 'there',
      buyerUsername: tx.buyer.username ?? 'A member',
      stars: dto.stars,
      comment: dto.comment ?? null,
      sellerUserId: tx.sellerId,
    });

    return rating;
  }

  /**
   * Buyer corrects their rating — allowed for EDIT_WINDOW_DAYS after
   * submission, and only while the seller has not replied. Re-runs the
   * contact filter and the seller recompute.
   */
  async update(
    transactionId: string,
    buyerClerkId: string,
    dto: CreateRatingDto,
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, rating: true },
    });
    if (!tx?.rating) throw new NotFoundException('Rating not found');
    if (tx.buyer.clerkId !== buyerClerkId)
      throw new ForbiddenException('Only the buyer can edit their rating');
    if (tx.rating.sellerRespondedAt)
      throw new BadRequestException(
        'The seller has replied to this review — it can no longer be edited.',
      );
    const ageDays =
      (Date.now() - new Date(tx.rating.createdAt).getTime()) / 86_400_000;
    if (ageDays > EDIT_WINDOW_DAYS)
      throw new BadRequestException(
        `Ratings can only be edited within ${EDIT_WINDOW_DAYS} days.`,
      );
    if (dto.comment) {
      const check = await this.contactFilter.check(
        dto.comment,
        'rating-comment',
        buyerClerkId,
      );
      if (!check.allowed) throw new BadRequestException(check.reason);
    }
    const updated = await this.prisma.rating.update({
      where: { id: tx.rating.id },
      data: { stars: dto.stars, comment: dto.comment ?? null },
    });
    await this.recalcSeller(tx.sellerId);
    return updated;
  }

  /**
   * Seller's single public reply to a review. Once, contact-filtered,
   * shown under the review on the public profile.
   */
  async respond(ratingId: string, sellerClerkId: string, response: string) {
    const trimmed = (response ?? '').trim();
    if (trimmed.length < 3 || trimmed.length > 500)
      throw new BadRequestException('Reply must be 3–500 characters.');
    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      include: { rated: true },
    });
    if (!rating) throw new NotFoundException('Rating not found');
    if (rating.rated.clerkId !== sellerClerkId)
      throw new ForbiddenException('Only the rated seller can reply');
    if (rating.sellerRespondedAt)
      throw new ConflictException('You have already replied to this review');
    const check = await this.contactFilter.check(
      trimmed,
      'rating-response',
      sellerClerkId,
    );
    if (!check.allowed) throw new BadRequestException(check.reason);
    return this.prisma.rating.update({
      where: { id: ratingId },
      data: { sellerResponse: trimmed, sellerRespondedAt: new Date() },
    });
  }

  /**
   * Admin removal of an abusive/defamatory review — reason mandatory,
   * audited, seller score recomputed after.
   */
  async adminRemove(ratingId: string, adminId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5)
      throw new BadRequestException('A reason is required to remove a rating.');
    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
    });
    if (!rating) throw new NotFoundException('Rating not found');
    await this.prisma.rating.delete({ where: { id: ratingId } });
    await this.audit.record({
      adminUserId: adminId,
      action: 'RATING_REMOVE',
      resourceType: 'Rating',
      resourceId: ratingId,
      oldValue: `${rating.stars}★ by ${rating.raterId} on ${rating.ratedId}: ${rating.comment ?? '(no comment)'}`,
      newValue: 'removed',
      reason: trimmed,
    });
    await this.recalcSeller(rating.ratedId);
    return { ok: true };
  }

  /**
   * Daily cron — refresh trust scores for sellers with recent activity
   * (a released sale, delivery or rating in the last 48h). Keeps the
   * time-based score components fresh now that viewing the dashboard no
   * longer triggers a recompute-write.
   */
  async recalcRecentSellers(): Promise<number> {
    const floor = new Date(Date.now() - 48 * 3_600_000);
    const recent = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { releasedAt: { gte: floor } },
          { deliveredAt: { gte: floor } },
          { rating: { is: { updatedAt: { gte: floor } } } },
        ],
      },
      select: { sellerId: true },
      distinct: ['sellerId'],
      take: 200,
    });
    for (const r of recent) {
      await this.recalcSeller(r.sellerId).catch(() => undefined);
    }
    return recent.length;
  }

  async findForSeller(sellerClerkId: string, clerkId?: string) {
    const user = await this.prisma.user.findUnique({
      // Closed accounts have no public review page. GET /ratings/seller/:clerkId
      // is a public route in its own right, so it is NOT covered by the seller
      // profile 404 (sellers-public.controller.ts) — /sellers/[clerkId] calls
      // both and notFound()s on either, but anyone holding the old link can
      // still hit this one directly. Each row here carries the reviewer's
      // handle and the LISTING TITLE, so serving it after closure republishes
      // exactly what the closure was meant to take down.
      where: { clerkId: sellerClerkId, accountClosedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.rating.findMany({
      where: {
        ratedId: user.id,
        // A review embeds the listing TITLE ("Great seller - Glock 19 arrived
        // fast") and the reviewer's free-text comment, so a seller profile was
        // a back door onto members-only stock. Signed out, drop reviews that
        // belong to a members-only listing entirely rather than blanking the
        // title — the comment is user-authored and would leak the same thing.
        //
        // Consequence, accepted deliberately: the public review LIST can be
        // shorter than the cached averageRating was computed over. A rating
        // count that differs from a star average is a cosmetic inconsistency;
        // a firearm model name on a public page is the thing we are fixing.
        // Rating.transaction is a REQUIRED relation, so every rating has one —
        // no null branch needed.
        ...(clerkId
          ? {}
          : { transaction: { listing: { publicVisible: true } } }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        // Username only — reviews are publicly visible on the seller
        // profile, so we must not expose the rater's real name.
        rater: { select: { username: true } },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });
  }

  async getTrustDashboard(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    // Read-only — the cached score is refreshed on rating create/edit/
    // removal + the daily recalc cron. Viewing a page must never write
    // (the old recompute-on-view could flap a seller's tier mid-anything).
    const score = user.trustScore;
    const recentRatings = await this.prisma.rating.findMany({
      where: { ratedId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        // Username only — reviews are publicly visible on the seller
        // profile, so we must not expose the rater's real name.
        rater: { select: { username: true } },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });

    // Total ratings the cached averageRating is computed over — recentRatings
    // is capped at 10, so callers ("4.8 from 11 buyers") need this to say how
    // many the average is actually based on instead of falling back to
    // recentRatings.length (wrong for any seller with more than 10 reviews).
    const totalRatings = await this.prisma.rating.count({
      where: { ratedId: user.id },
    });

    return {
      trustScore: score,
      sellerTier: user.sellerTier,
      totalSales: user.totalSales,
      averageRating: user.averageRating,
      recentRatings,
      totalRatings,
    };
  }

  // ---------------------------------------------------------------
  // Private: recalculate trust score + tier and persist
  // ---------------------------------------------------------------
  async recalcSeller(sellerId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: sellerId },
      include: {
        sellerTransactions: {
          where: { paymentStatus: 'RELEASED' },
          include: { rating: true },
        },
        listings: {
          where: { claudeDecision: { in: ['APPROVE', 'AUTO_FIX_AND_APPROVE'] } },
          select: { claudeConfidence: true },
        },
      },
    });
    if (!user) return 0;

    const completedSales = user.sellerTransactions.length;

    const totalTx = await this.prisma.transaction.count({
      where: { sellerId, paymentStatus: { not: 'REFUNDED' } },
    });

    const deliveredCount = await this.prisma.transaction.count({
      where: { sellerId, shippingStatus: 'DELIVERED' },
    });

    // Component 1 — Completed sales (max 25)
    const salesScore = Math.min(25, (completedSales / 25) * 25);

    // Component 2 — Rating average (max 25)
    const starsList = user.sellerTransactions
      .filter((t) => t.rating)
      .map((t) => t.rating!.stars);
    const avgRating =
      starsList.length > 0 ? starsList.reduce((a, b) => a + b, 0) / starsList.length : 0;
    const ratingScore = (avgRating / 5) * 25;

    // Component 3 — Delivery success rate (max 20)
    const deliveryScore = totalTx > 0 ? (deliveredCount / totalTx) * 20 : 0;

    // Component 4 — Dispatch speed (max 15): avg hours paid→dispatched
    const dispatchedTx = user.sellerTransactions.filter((t) => t.paidAt && t.dispatchedAt);
    let speedScore = 7.5; // default if no data
    if (dispatchedTx.length > 0) {
      const avgHours =
        dispatchedTx.reduce((sum, t) => {
          const hours =
            (new Date(t.dispatchedAt!).getTime() - new Date(t.paidAt!).getTime()) / 3_600_000;
          return sum + hours;
        }, 0) / dispatchedTx.length;
      speedScore = avgHours < 24 ? 15 : avgHours < 48 ? 10 : avgHours < 72 ? 5 : 0;
    }

    // Component 5 — Listing quality (max 10): avg Claude confidence
    const avgConfidence =
      user.listings.length > 0
        ? user.listings.reduce((sum, l) => sum + (l.claudeConfidence ?? 0.5), 0) /
          user.listings.length
        : 0.5;
    const qualityScore = avgConfidence * 10;

    // Component 6 — Account age (max 5, full at 2 years)
    const ageYears =
      (Date.now() - new Date(user.createdAt).getTime()) / (1_000 * 60 * 60 * 24 * 365);
    const ageScore = Math.min(5, (ageYears / 2) * 5);

    const trustScore = Math.round(salesScore + ratingScore + deliveryScore + speedScore + qualityScore + ageScore);

    // Tier (DEALER is sticky — never auto-changed)
    const newTier = user.sellerTier === 'DEALER'
      ? 'DEALER'
      : this.calcTier(completedSales, trustScore);

    // Cached average rating
    const newAvg = starsList.length > 0 ? Math.round((avgRating * 10)) / 10 : null;

    await this.prisma.user.update({
      where: { id: sellerId },
      data: {
        trustScore,
        sellerTier: newTier,
        averageRating: newAvg,
      },
    });

    return trustScore;
  }

  private calcTier(sales: number, score: number): SellerTier {
    if (sales >= 25 && score >= 85) return 'TOP_SELLER';
    if (sales >= 10 && score >= 70) return 'TRUSTED';
    if (sales >= 3 && score >= 50) return 'ESTABLISHED';
    return 'NEW';
  }
}
