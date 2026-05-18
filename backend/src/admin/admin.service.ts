import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingReviewDto, ReviewAction } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------
  async stats() {
    const [pendingListings, pendingPayments, totalUsers, bannedUsers] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.transaction.count({ where: { paymentStatus: 'PENDING_ADMIN_VERIFICATION' } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isBanned: true } }),
    ]);
    return { pendingListings, pendingPayments, totalUsers, bannedUsers };
  }

  // ---------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------
  async getListings(status?: string, page = 1, limit = 20) {
    const where = status ? { status: status as never } : { status: 'PENDING_REVIEW' as never };
    const [listings, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: {
          seller: { select: { id: true, clerkId: true, firstName: true, lastName: true, email: true, sellerTier: true } },
          category: { select: { name: true, isFirearm: true } },
          images: { where: { isPrimary: true }, take: 1 },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { listings, total, page, limit };
  }

  async reviewListing(listingId: string, adminId: string, dto: ListingReviewDto) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'PENDING_REVIEW')
      throw new BadRequestException('Listing is not pending review');

    const newStatus = dto.action === ReviewAction.APPROVE ? 'ACTIVE' : 'CANCELLED';
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: newStatus,
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
        adminOverrideReason: dto.reason ?? null,
        ...(newStatus === 'ACTIVE' ? { expiresAt: new Date(Date.now() + 60 * 24 * 3600_000) } : {}),
      },
      include: { seller: { select: { email: true, firstName: true, lastName: true } } },
    });

    const sellerDetails = {
      listingTitle: updated.title,
      listingId: updated.id,
      sellerEmail: updated.seller.email,
      sellerName: [updated.seller.firstName, updated.seller.lastName].filter(Boolean).join(' ') || 'Seller',
      reason: dto.reason,
    };
    void (newStatus === 'ACTIVE'
      ? this.notifications.listingApproved(sellerDetails)
      : this.notifications.listingRejected(sellerDetails));

    return updated;
  }

  // ---------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------
  async getUsers(search?: string, page = 1, limit = 30) {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          clerkId: true,
          email: true,
          firstName: true,
          lastName: true,
          sellerTier: true,
          kycStatus: true,
          isBanned: true,
          totalSales: true,
          trustScore: true,
          averageRating: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  }

  async updateUser(userId: string, adminId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (dto.sellerTier !== undefined) data.sellerTier = dto.sellerTier;
    if (dto.kycStatus !== undefined) {
      data.kycStatus = dto.kycStatus;
      if (dto.kycStatus === 'VERIFIED') data.kycVerifiedAt = new Date();
    }
    if (dto.isBanned !== undefined) {
      data.isBanned = dto.isBanned;
      data.bannedAt = dto.isBanned ? new Date() : null;
    }

    return this.prisma.user.update({ where: { id: userId }, data });
  }

  // ---------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------
  async getTransactions(status?: string, page = 1, limit = 20) {
    const where = status
      ? { paymentStatus: status as never }
      : { paymentStatus: 'PENDING_ADMIN_VERIFICATION' as never };
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          listing: { select: { title: true, price: true } },
          buyer: { select: { firstName: true, lastName: true, email: true } },
          seller: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { transactions, total, page, limit };
  }

  async releaseTransaction(txId: string, adminId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.paymentStatus !== 'PENDING_ADMIN_VERIFICATION')
      throw new BadRequestException('Transaction is not pending admin verification');

    return this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: txId },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: new Date(),
          adminReviewedById: adminId,
          adminReviewedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      }),
    ]);
  }

  async refundTransaction(txId: string, adminId: string, note?: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { listing: true, buyer: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        paymentStatus: 'REFUNDED',
        adminNote: note ?? null,
        adminReviewedById: adminId,
        adminReviewedAt: new Date(),
      },
    });

    void this.notifications.refundIssuedBuyer({
      buyerEmail: tx.buyer.email,
      buyerName: [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') || 'Buyer',
      listingTitle: tx.listing.title,
      buyerTotal: tx.buyerTotal,
      transactionId: txId,
      note,
    });

    return updated;
  }
}
