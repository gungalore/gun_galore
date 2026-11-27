import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../payments/transactions.service';
import { ActivityService } from '../activity/activity.service';
import { CreateOrderDto } from '../payments/dto/create-order.dto';

// Phase 8b — multi-item single-seller cart. A thin facade: checkout delegates
// to TransactionsService (which owns the hardened reserve/fan-out money path);
// the reads serve the buyer's grouped "My Orders" surfaces.
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly activity: ActivityService,
  ) {}

  checkout(userId: string, dto: CreateOrderDto, frontendUrl: string) {
    this.activity.record({
      eventType: 'checkout_started',
      actor: { userId },
      metadata: { lines: Array.isArray(dto.lines) ? dto.lines.length : 1 },
    });
    return this.transactions.createOrderCheckout(userId, dto, frontendUrl);
  }

  async myOrders(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return [];
    return this.prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        lineItems: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                images: { take: 1, select: { url: true } },
              },
            },
          },
        },
        transactions: {
          select: { id: true, paymentStatus: true, shippingStatus: true },
        },
      },
    });
  }

  async getOrder(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Order not found');
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                images: { take: 1, select: { url: true } },
              },
            },
            transaction: {
              select: {
                id: true,
                paymentStatus: true,
                shippingStatus: true,
                shippingMethod: true,
                buyerTotal: true,
              },
            },
          },
        },
      },
    });
    // Ownership: only the buyer can read their own order.
    if (!order || order.buyerId !== user.id) {
      throw new NotFoundException('Order not found');
    }

    /**
     * ⚠️ ONE RATING PER SELLER PER ORDER (operator, 2026-11-27).
     *
     * A multi-seller cart has one Order and many line Transactions, and ratings
     * hang off a Transaction. The old page could only rate "a line", so a seller
     * with two lines could be rated twice and the buyer had no single surface to
     * rate the other sellers from. This grouping gives the order page one entry
     * per seller: where to rate them, whether they can be rated yet, and the
     * rating if it exists — on whichever line it was left.
     */
    const sellerIds = [
      ...new Set(order.lineItems.map((line) => line.sellerId)),
    ];
    const [sellerRows, ratingRows] = await Promise.all([
      sellerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: sellerIds } },
            select: { id: true, username: true },
          })
        : Promise.resolve([] as { id: string; username: string | null }[]),
      this.prisma.rating.findMany({
        where: { transaction: { is: { orderId: order.id } } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          stars: true,
          comment: true,
          sellerResponse: true,
          sellerRespondedAt: true,
          createdAt: true,
          transactionId: true,
          ratedId: true,
        },
      }),
    ]);
    const usernameById = new Map(
      sellerRows.map((row) => [row.id, row.username]),
    );
    // One rating per seller is enforced by `create`; newest wins here if legacy
    // data ever carries two.
    const ratingBySeller = new Map<string, (typeof ratingRows)[number]>();
    for (const row of ratingRows) {
      if (!ratingBySeller.has(row.ratedId)) {
        ratingBySeller.set(row.ratedId, row);
      }
    }
    const sellers = sellerIds.map((sellerId) => {
      const lines = order.lineItems.filter((line) => line.sellerId === sellerId);
      const rating = ratingBySeller.get(sellerId) ?? null;
      const releasedLine = lines.find(
        (line) => line.transaction?.paymentStatus === 'RELEASED',
      );
      const allReleased =
        lines.length > 0 &&
        lines.every((line) => line.transaction?.paymentStatus === 'RELEASED');
      return {
        sellerId,
        username: usernameById.get(sellerId) ?? 'A member',
        transactionId: releasedLine?.transaction?.id ?? null,
        canRate: !rating && allReleased,
        rating: rating
          ? {
              id: rating.id,
              stars: rating.stars,
              comment: rating.comment,
              sellerResponse: rating.sellerResponse,
              sellerRespondedAt: rating.sellerRespondedAt,
              createdAt: rating.createdAt,
              transactionId: rating.transactionId,
            }
          : null,
      };
    });

    // FLOW-F3 — re-viewable EFT instructions. The banking details used to be
    // shown exactly once on the post-checkout screen; if the buyer navigated
    // away, an UNPAID order was unrecoverable from the UI. While the order is
    // awaiting payment (unpaid, not cancelled, window open) the detail payload
    // carries the GG bank details so the page can re-render the full
    // ManualEftInstructions block (reference + amount + account).
    // Manual EFT retired (Phase 1) — GG bank details are never exposed.
    return {
      ...order,
      bankDetails: null,
      sellers,
    };
  }
}
