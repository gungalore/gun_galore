import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SellerTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRatingDto } from './dto/create-rating.dto';

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(transactionId: string, buyerClerkId: string, dto: CreateRatingDto) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, seller: true, rating: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyer.clerkId !== buyerClerkId) throw new ForbiddenException('Only the buyer can rate');
    if (tx.rating) throw new ConflictException('Transaction already has a rating');
    if (tx.paymentStatus !== 'RELEASED')
      throw new BadRequestException('Can only rate after payment has been released');

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

    return rating;
  }

  async findForSeller(sellerClerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: sellerClerkId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.rating.findMany({
      where: { ratedId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        rater: { select: { firstName: true, lastName: true } },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });
  }

  async getTrustDashboard(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    const score = await this.recalcSeller(user.id);
    const recentRatings = await this.prisma.rating.findMany({
      where: { ratedId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        rater: { select: { firstName: true, lastName: true } },
        transaction: { select: { listing: { select: { title: true } } } },
      },
    });

    return {
      trustScore: score,
      sellerTier: user.sellerTier,
      totalSales: user.totalSales,
      averageRating: user.averageRating,
      recentRatings,
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
