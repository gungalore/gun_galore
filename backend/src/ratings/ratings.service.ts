import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { maskBadLanguage } from '../moderation/bad-language';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { computeTrust } from './trust-score';

// Buyers may correct a rating for this long after submitting (fat-finger
// insurance) — the window closes EARLY if the seller has already replied,
// so an exchange can never be rewritten out from under a response.
const EDIT_WINDOW_DAYS = 30;

/**
 * How many reviews the public profile endpoint serves.
 *
 * ⚠️ CAPPED, NOT UNBOUNDED. The seller page renders a scrollable list and the
 * storefront shows the cached `averageRating` beside `totalRatings`; returning
 * every row a long-lived seller ever received was an unbounded payload and a
 * scrape target.
 */
const PUBLIC_REVIEW_LIMIT = 50;

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Mask profanity and keep the contact-detail filter honest.
   *
   * ⚠️ REVIEWS ARE PUBLIC FREE TEXT. Until now they only went through the
   * contact-detail filter, while feed posts and comments also run
   * `maskBadLanguage` — so a review could publish raw profanity the community
   * feed never would. The mask runs FIRST and the contact filter second, so a
   * handle-allowed word cannot be hidden behind masking and a masked reply is
   * still checked for phone numbers.
   */
  private cleanPublicText(raw: string | null | undefined): string | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    return maskBadLanguage(trimmed);
  }

  async create(transactionId: string, buyerId: string, dto: CreateRatingDto) {
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
    if (tx.buyer.id !== buyerId) throw new ForbiddenException('Only the buyer can rate');
    /**
     * ⚠️ ONE RATING PER SELLER PER ORDER (operator, 2026-11-27).
     *
     * A rating hangs off one Transaction (one cart line), so without this a
     * seller with two lines in the same order could be rated twice, and a
     * multi-seller order had no single place to rate each seller. The order page
     * rates every seller once; the backend refuses the second attempt even when
     * it arrives on a different line.
     */
    if (tx.orderId) {
      const alreadyRated = await this.prisma.rating.findFirst({
        where: {
          ratedId: tx.sellerId,
          transaction: { is: { orderId: tx.orderId } },
        },
        select: { id: true },
      });
      if (alreadyRated)
        throw new ConflictException(
          'You have already rated this seller for this order.',
        );
    }
    if (tx.rating) throw new ConflictException('Transaction already has a rating');
    if (tx.paymentStatus !== 'RELEASED')
      throw new BadRequestException('Can only rate after payment has been released');

    // Rating comments are public on the seller's profile, so a contact
    // detail in a comment routes around platform fees identically to a
    // note-to-seller, and profanity bypasses the same community standard.
    // Mask, then block contact details, before the DB write.
    const comment = this.cleanPublicText(dto.comment);
    if (comment) {
      const check = await this.contactFilter.check(
        comment,
        'rating-comment',
        buyerId,
        // No admin review screen for reviews: a REVIEW-band Jev verdict is a
        // block, so hateful/derogatory wording never gets published to wait
        // for a human who does not exist.
        { blockOnReview: true },
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    let rating;
    try {
      rating = await this.prisma.rating.create({
        data: {
          transactionId,
          raterId: tx.buyerId,
          ratedId: tx.sellerId,
          stars: dto.stars,
          comment,
        },
      });
    } catch (err) {
      /**
       * ⚠️ THE `tx.rating` CHECK IS NOT ATOMIC. Two concurrent POSTs for the
       * same transaction both read `rating: null`, both attempt the insert, and
       * the loser hits `Rating.transactionId @unique` — a raw P2002, which Nest
       * turned into a 500. The constraint is the real guard; map it to the same
       * 409 the pre-check throws.
       */
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Transaction already has a rating');
      }
      throw err;
    }

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
      comment,
      sellerUserId: tx.sellerId,
    });

    return rating;
  }

  /**
   * Buyer corrects their rating — allowed for EDIT_WINDOW_DAYS after
   * submission, and only while the seller has not replied. Re-runs the
   * contact filter and the seller recompute.
   *
   * ⚠️ ORDER-AWARE (2026-11-27). On a multi-line checkout the rating may hang
   * off ANY line of the seller's in the order, and the order page can send the
   * edit through a different line's transaction id. The rating is looked up by
   * order + seller, not by the URL's line, so the same rating is edited either
   * way — a per-line lookup would 404 the moment the UI picked another line.
   */
  async update(
    transactionId: string,
    buyerId: string,
    dto: CreateRatingDto,
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, rating: true },
    });
    if (!tx) throw new NotFoundException('Rating not found');
    if (tx.buyer.id !== buyerId)
      throw new ForbiddenException('Only the buyer can edit their rating');

    let rating: {
      id: string;
      createdAt: Date;
      sellerRespondedAt: Date | null;
      raterId: string;
    } | null = tx.rating
      ? {
          id: tx.rating.id,
          createdAt: tx.rating.createdAt,
          sellerRespondedAt: tx.rating.sellerRespondedAt,
          raterId: tx.buyerId,
        }
      : null;
    if (tx.orderId) {
      const byOrder = await this.prisma.rating.findFirst({
        where: {
          ratedId: tx.sellerId,
          transaction: { is: { orderId: tx.orderId } },
        },
        select: {
          id: true,
          createdAt: true,
          sellerRespondedAt: true,
          raterId: true,
        },
      });
      if (!byOrder) throw new NotFoundException('Rating not found');
      if (byOrder.raterId !== buyerId)
        throw new ForbiddenException('Only the buyer can edit their rating');
      rating = byOrder;
    }
    if (!rating) throw new NotFoundException('Rating not found');
    if (rating.sellerRespondedAt)
      throw new BadRequestException(
        'The seller has replied to this review — it can no longer be edited.',
      );
    const ageDays =
      (Date.now() - new Date(rating.createdAt).getTime()) / 86_400_000;
    if (ageDays > EDIT_WINDOW_DAYS)
      throw new BadRequestException(
        `Ratings can only be edited within ${EDIT_WINDOW_DAYS} days.`,
      );
    // Mask first, block contact details second — the same rule as create(), so
    // editing cannot reintroduce profanity the create path removed.
    const comment = this.cleanPublicText(dto.comment);
    if (comment) {
      const check = await this.contactFilter.check(
        comment,
        'rating-comment',
        buyerId,
        { blockOnReview: true },
      );
      if (!check.allowed) throw new BadRequestException(check.reason);
    }
    const updated = await this.prisma.rating.update({
      where: { id: rating.id },
      data: { stars: dto.stars, comment },
    });
    await this.recalcSeller(tx.sellerId);
    return updated;
  }

  /**
   * Seller's single public reply to a review. Once, contact-filtered,
   * shown under the review on the public profile — and the buyer is told.
   */
  async respond(ratingId: string, sellerId: string, response: string) {
    const trimmed = (response ?? '').trim();
    if (trimmed.length < 3 || trimmed.length > 500)
      throw new BadRequestException('Reply must be 3–500 characters.');
    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      // The buyer is notified, so their email/name are needed here; the seller's
      // own row supplies the handle shown in that notification.
      include: { rated: true, rater: true },
    });
    if (!rating) throw new NotFoundException('Rating not found');
    if (rating.rated.id !== sellerId)
      throw new ForbiddenException('Only the rated seller can reply');
    if (rating.sellerRespondedAt)
      throw new ConflictException('You have already replied to this review');
    /**
     * ⚠️ THE REPLY IS PUBLIC FREE TEXT TOO. Mask profanity first, then the
     * contact filter — the length rule is checked on the trimmed source above,
     * which masking preserves. Reviews have no admin review screen, so the
     * REVIEW band blocks here (see ContactDetailFilterService.check).
     */
    const masked = maskBadLanguage(trimmed);
    const check = await this.contactFilter.check(
      masked,
      'rating-response',
      sellerId,
      { blockOnReview: true },
    );
    if (!check.allowed) throw new BadRequestException(check.reason);
    const updated = await this.prisma.rating.update({
      where: { id: ratingId },
      data: { sellerResponse: masked, sellerRespondedAt: new Date() },
    });
    /**
     * ⚠️ FIRE-AND-FORGET. The reply is already stored; an email/inbox failure
     * must never turn a successful reply into an error for the seller.
     */
    void this.notifications
      .ratingReplied({
        email: rating.rater.email,
        name: rating.rater.firstName ?? 'there',
        sellerUsername: rating.rated.username ?? 'The seller',
        stars: rating.stars,
        response: masked,
        sellerId: rating.rated.id,
      })
      .catch(() => undefined);
    return updated;
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
   * Daily cron — refresh trust scores.
   *
   * ⚠️ IT USED TO REFRESH ONLY SELLERS WITH ACTIVITY IN THE LAST 48 HOURS. A
   * quiet seller's ACCOUNT-AGE points therefore never moved again, and any
   * refund/return effect on a completed sale never reached their score until
   * they sold something new. The sweep now covers every seller who has any
   * listing or any transaction (the recent-activity pass is kept first, since
   * those are the scores most likely to have moved), deduped and bounded at
   * 500 sellers per run. The count is logged as today's sweep size.
   */
  async recalcRecentSellers(): Promise<number> {
    const floor = new Date(Date.now() - 48 * 3_600_000);

    const [recent, listingSellers, transactionSellers] = await Promise.all([
      this.prisma.transaction.findMany({
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
      }),
      this.prisma.listing.findMany({
        select: { sellerId: true },
        distinct: ['sellerId'],
        take: 500,
      }),
      this.prisma.transaction.findMany({
        select: { sellerId: true },
        distinct: ['sellerId'],
        take: 500,
      }),
    ]);

    const sellerIds = [
      ...new Set(
        [...recent, ...listingSellers, ...transactionSellers]
          .map((row) => row.sellerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].slice(0, 500);

    for (const sellerId of sellerIds) {
      await this.recalcSeller(sellerId).catch(() => undefined);
    }
    this.logger.log(`Seller trust scores refreshed: ${sellerIds.length}`);
    return sellerIds.length;
  }

  async findForSeller(sellerId: string, userId?: string) {
    const user = await this.prisma.user.findUnique({
      // Closed accounts have no public review page. GET /ratings/seller/:userId
      // is a public route in its own right, so it is NOT covered by the seller
      // profile 404 (sellers-public.controller.ts) — /sellers/[userId] calls
      // both and notFound()s on either, but anyone holding the old link can
      // still hit this one directly. Each row here carries the reviewer's
      // handle and the LISTING TITLE, so serving it after closure republishes
      // exactly what the closure was meant to take down.
      where: { id: sellerId, accountClosedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const rows = await this.prisma.rating.findMany({
      where: {
        ratedId: user.id,
        // A review embeds the listing TITLE and the reviewer's free-text
        // comment. Content no longer varies by signed-in state: a declared
        // 18+ visitor (or a member) sees the whole catalogue, and
        // ContentAccessGuard has already refused anyone else before this
        // handler runs. Do not reintroduce a publicVisible filter here — it
        // is what made a seller profile a back door onto hidden stock.
      },
      orderBy: { createdAt: 'desc' },
      // ⚠️ CAPPED. The storefront shows `averageRating` with the real
      // `totalRatings` count from the seller profile, so the public list only
      // needs the most recent page — not every review a long-lived seller has
      // ever received.
      take: PUBLIC_REVIEW_LIMIT,
      include: {
        // Username only �?" reviews are publicly visible on the seller
        // profile, so we must not expose the rater's real name. Verification
        // is three booleans, never the underlying contact rows.
        rater: {
          select: {
            username: true,
            phoneVerified: true,
            emailVerifiedAt: true,
            kycIdVerifiedAt: true,
          },
        },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });
    return rows.map(
      ({ rater, raterId: _raterId, ratedId: _ratedId, transactionId: _txId, ...row }) => {
        const { phoneVerified, emailVerifiedAt, kycIdVerifiedAt, ...publicRater } =
          rater;
        return {
          ...row,
          rater: {
            ...publicRater,
            verification: {
              phoneVerified,
              emailVerified: emailVerifiedAt != null,
              idVerified: kycIdVerifiedAt != null,
            },
          },
        };
      },
    );
  }

  async getTrustDashboard(userId: string) {
    // Same loader as recalcSeller, so the bars and the cached score can never
    // be computed from different rules. READ-ONLY: viewing a page must never
    // write (the old recompute-on-view could flap a seller's tier mid-anything).
    const user = await this.loadTrustInput(userId);
    if (!user) throw new NotFoundException('User not found');

    const trust = computeTrust({
      transactions: user.sellerTransactions,
      listings: user.listings,
      createdAt: user.createdAt,
    });

    const recentRatings = await this.prisma.rating.findMany({
      where: { ratedId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        // Username only �?" reviews are publicly visible on the seller
        // profile, so we must not expose the rater's real name.
        rater: {
          select: {
            username: true,
            phoneVerified: true,
            emailVerifiedAt: true,
            kycIdVerifiedAt: true,
          },
        },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });
    const shapedRatings = recentRatings.map(({ rater, ...row }) => {
      const {
        phoneVerified,
        emailVerifiedAt,
        kycIdVerifiedAt,
        ...publicRater
      } = rater;
      return {
        ...row,
        rater: {
          ...publicRater,
          verification: {
            phoneVerified,
            emailVerified: emailVerifiedAt != null,
            idVerified: kycIdVerifiedAt != null,
          },
        },
      };
    });

    // Total ratings the cached averageRating is computed over — recentRatings
    // is capped at 10, so callers ("4.8 from 11 buyers") need this to say how
    // many the average is actually based on instead of falling back to
    // recentRatings.length (wrong for any seller with more than 10 reviews).
    const totalRatings = await this.prisma.rating.count({
      where: { ratedId: user.id },
    });

    /**
     * ⚠️ THE COMPONENTS ARE SERVED, NOT DERIVED ON THE CLIENT. The dashboard
     * used to paint four of its six bars from `trustScore × weight` because the
     * real per-component points never left the server — the bars could not agree
     * with the score, let alone explain it. `components` are the exact points
     * each rule awarded (out of the 25/25/20/15/10/5 maxima); their sum, rounded,
     * is `trustScore`.
     */
    return {
      trustScore: trust.trustScore,
      sellerTier: trust.tier,
      totalSales: user.totalSales,
      averageRating: trust.averageRating,
      components: trust.components,
      completedSales: trust.completedSales,
      recentRatings: shapedRatings,
      totalRatings,
    };
  }

  // ---------------------------------------------------------------
  // Trust score
  // ---------------------------------------------------------------

  /**
   * The seller row the trust calculator needs.
   *
   * ⚠️ ONE LOADER FOR RECALC AND DASHBOARD. The audit found the dashboard
   * showing a cached total beside fabricated bars; a second query path is how
   * the two drift apart again.
   *
   * ⚠️ SWAP LEGS ARE FILTERED OUT AT THE QUERY TOO. The calculator excludes them
   * from every count (they are accounting rows, not sales), but there is no
   * reason to read them for a score.
   */
  private async loadTrustInput(sellerId: string) {
    return this.prisma.user.findUnique({
      where: { id: sellerId },
      include: {
        sellerTransactions: {
          where: { swapId: null },
          include: { rating: true },
        },
        listings: {
          where: { claudeDecision: { in: ['APPROVE', 'AUTO_FIX_AND_APPROVE'] } },
          select: { claudeConfidence: true },
        },
      },
    });
  }

  /** Recompute and persist the publicly cached trust fields. */
  async recalcSeller(sellerId: string): Promise<number> {
    const user = await this.loadTrustInput(sellerId);
    if (!user) return 0;

    const trust = computeTrust({
      transactions: user.sellerTransactions,
      listings: user.listings,
      createdAt: user.createdAt,
    });

    await this.prisma.user.update({
      where: { id: sellerId },
      data: {
        trustScore: trust.trustScore,
        sellerTier: trust.tier,
        averageRating: trust.averageRating,
      },
    });

    return trust.trustScore;
  }
}
