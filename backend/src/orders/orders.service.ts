import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../payments/transactions.service';
import { CreateOrderDto } from '../payments/dto/create-order.dto';

// Phase 8b — multi-item single-seller cart. A thin facade: checkout delegates
// to TransactionsService (which owns the hardened reserve/fan-out money path);
// the reads serve the buyer's grouped "My Orders" surfaces.
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  checkout(clerkId: string, dto: CreateOrderDto, frontendUrl: string) {
    return this.transactions.createOrderCheckout(clerkId, dto, frontendUrl);
  }

  async myOrders(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
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

  async getOrder(id: string, clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
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
    };
  }
}
