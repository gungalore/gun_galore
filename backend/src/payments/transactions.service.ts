import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeeCalculator } from './fee.calculator';
import { PeachService } from './peach.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListingStatus, ShippingMethod } from '@prisma/client';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeCalculator,
    private readonly notifications: NotificationsService,
    private readonly peach: PeachService,
  ) {}

  // ------------------------------------------------------------------
  // Create a transaction and a Peach checkout session
  // ------------------------------------------------------------------
  async create(
    buyerClerkId: string,
    dto: CreateTransactionDto,
    frontendUrl: string,
  ) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    if (buyer.isBanned) throw new ForbiddenException('Account is banned');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      include: { seller: true },
    });

    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException('Listing is no longer available');
    }
    if (listing.listingType !== 'BUY_NOW') {
      throw new BadRequestException('Only BUY_NOW listings support direct checkout');
    }
    if (listing.sellerId === buyer.id) {
      throw new BadRequestException('Sellers cannot buy their own listings');
    }

    // Enforce shipping routing rules
    this.validateShipping(listing.isFirearm, dto.shippingMethod);

    // If dealer transfer, verify the dealer exists and is active
    if (dto.shippingMethod === 'DEALER_TRANSFER' && dto.dealerId) {
      const dealer = await this.prisma.dealer.findUnique({ where: { id: dto.dealerId } });
      if (!dealer || !dealer.isActive) throw new NotFoundException('Dealer not found or inactive');
    }

    const isTopSeller = listing.seller.sellerTier === 'TOP_SELLER';
    const { listingPrice, commissionZar, processingFee, buyerTotal, sellerPayout } =
      this.fees.breakdown(listing.price, listing.passFeeToBuyer, isTopSeller);

    // Reserve the listing
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: ListingStatus.PAYMENT_PENDING },
    });

    // Create the transaction record first to get an ID
    const tx = await this.prisma.transaction.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        listingPrice,
        commissionZar,
        processingFee,
        passFeeToBuyer: listing.passFeeToBuyer,
        buyerTotal,
        sellerPayout,
        shippingMethod: dto.shippingMethod,
        pudoPickupLockerId: dto.pudoPickupLockerId,
        deliveryAddress: dto.deliveryAddress ? { ...dto.deliveryAddress } : undefined,
        dealerId: dto.dealerId,
      },
    });

    // Create Peach checkout
    const resultUrl = `${frontendUrl}/checkout/complete?transactionId=${tx.id}`;
    let peachCheckout;
    try {
      peachCheckout = await this.peach.createCheckout({
        amountZarCents: buyerTotal,
        merchantTransactionId: tx.id,
        shopperResultUrl: resultUrl,
        shopperEmail: buyer.email,
        description: listing.title.slice(0, 100),
      });
    } catch (err) {
      // Roll back listing status if Peach fails
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ACTIVE },
      });
      await this.prisma.transaction.delete({ where: { id: tx.id } });
      throw new BadRequestException(`Payment checkout failed: ${(err as Error).message}`);
    }

    // Store checkout ID
    const updated = await this.prisma.transaction.update({
      where: { id: tx.id },
      data: { peachCheckoutId: peachCheckout.checkoutId },
    });

    return {
      transactionId: updated.id,
      peachCheckoutId: peachCheckout.checkoutId,
      widgetScriptUrl: peachCheckout.widgetScriptUrl,
      breakdown: { listingPrice, commissionZar, processingFee, buyerTotal, sellerPayout },
    };
  }

  // ------------------------------------------------------------------
  // Called from the result page — verify payment with Peach
  // ------------------------------------------------------------------
  async verifyResult(transactionId: string, resourcePath: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // Already processed — idempotent
    if (tx.paidAt) return { success: true, alreadyProcessed: true };

    try {
      const result = await this.peach.verifyPayment(resourcePath);
      if (result.isSuccess) {
        await this.markPaid(tx.id, result.paymentId, result.resultCode, tx.listing);
        return { success: true };
      }
      // Payment failed — revert listing
      await this.revertListing(tx.listingId);
      return { success: false, resultCode: result.resultCode };
    } catch (err) {
      this.logger.error('Peach verify failed', err);
      throw new BadRequestException('Payment verification failed');
    }
  }

  // ------------------------------------------------------------------
  // Called from Peach webhook
  // ------------------------------------------------------------------
  async handlePeachWebhook(body: Record<string, unknown>) {
    const result = this.peach.parseWebhookPayload(body);
    if (!result.merchantTransactionId) {
      this.logger.warn('Peach webhook: missing merchantTransactionId');
      return;
    }

    const tx = await this.prisma.transaction.findUnique({
      where: { id: result.merchantTransactionId },
      include: { listing: true },
    });
    if (!tx) {
      this.logger.warn(`Peach webhook: unknown transaction ${result.merchantTransactionId}`);
      return;
    }
    if (tx.paidAt) {
      this.logger.log(`Peach webhook: transaction ${tx.id} already processed`);
      return;
    }

    if (result.isSuccess) {
      await this.markPaid(tx.id, result.paymentId, result.resultCode, tx.listing);
    } else {
      this.logger.warn(`Peach webhook: payment failed ${result.resultCode}`);
      await this.revertListing(tx.listingId);
    }
  }

  // ------------------------------------------------------------------
  // Seller confirms item dispatched
  // ------------------------------------------------------------------
  async confirmDispatch(
    transactionId: string,
    sellerClerkId: string,
    data: { pudoDropoffLockerId?: string; trackingReference?: string },
  ) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction not found');

    const seller = await this.prisma.user.findUnique({ where: { clerkId: sellerClerkId } });
    if (!seller || tx.sellerId !== seller.id) {
      throw new ForbiddenException('Not authorised');
    }
    if (!tx.paidAt) throw new BadRequestException('Payment not confirmed yet');
    if (tx.dispatchedAt) throw new BadRequestException('Already dispatched');

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        dispatchedAt: new Date(),
        shippingStatus: 'COLLECTED',
        pudoDropoffLockerId: data.pudoDropoffLockerId,
        trackingReference: data.trackingReference,
      },
    });
    void this.sendDispatchedNotification(transactionId);
    return updated;
  }

  // ------------------------------------------------------------------
  // Fetch transactions for a user (buyer or seller view)
  // ------------------------------------------------------------------
  async findForUser(clerkId: string, role: 'buyer' | 'seller') {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    const where = role === 'buyer' ? { buyerId: user.id } : { sellerId: user.id };

    return this.prisma.transaction.findMany({
      where,
      include: {
        listing: { include: { images: { where: { isPrimary: true }, take: 1 } } },
        buyer: { select: { firstName: true, lastName: true } },
        seller: { select: { firstName: true, lastName: true } },
        dealer: { select: { id: true, name: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(transactionId: string, clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: { include: { images: { orderBy: { order: 'asc' } }, category: true } },
        buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
        seller: { select: { id: true, firstName: true, lastName: true } },
        dealer: true,
      },
    });

    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== user.id && tx.sellerId !== user.id) {
      throw new ForbiddenException('Not authorised');
    }

    return tx;
  }

  // ------------------------------------------------------------------
  // Buyer confirms delivery → releases payment, increments totalSales
  // ------------------------------------------------------------------
  async confirmDelivery(transactionId: string, buyerClerkId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyer.clerkId !== buyerClerkId) throw new ForbiddenException('Only the buyer can confirm delivery');
    if (tx.paymentStatus !== 'HELD') throw new BadRequestException('Payment is not in HELD state');
    if (tx.confirmedDeliveryAt) throw new BadRequestException('Delivery already confirmed');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: now,
          confirmedDeliveryAt: now,
          deliveredAt: tx.deliveredAt ?? now,
          shippingStatus: 'DELIVERED',
        },
      }),
      this.prisma.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      }),
    ]);

    this.logger.log(`Transaction ${transactionId} delivery confirmed — payment released`);
    void this.sendReleasedNotification(transactionId);
    return { released: true };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------
  private async markPaid(
    txId: string,
    paymentId: string,
    resultCode: string,
    listing: { id: string; sellerId: string },
  ) {
    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: txId },
        data: {
          paymentStatus: 'HELD',
          peachPaymentId: paymentId,
          peachResultCode: resultCode,
          paidAt: new Date(),
        },
      }),
      this.prisma.listing.update({
        where: { id: listing.id },
        data: { status: 'SOLD', soldAt: new Date() },
      }),
    ]);

    this.logger.log(`Transaction ${txId} paid — listing ${listing.id} marked SOLD`);

    // Fire-and-forget notifications
    void this.sendSaleNotifications(txId);
  }

  private async revertListing(listingId: string) {
    await this.prisma.listing.update({
      where: { id: listingId },
      data: { status: 'ACTIVE' },
    });
  }

  private async sendSaleNotifications(txId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        include: {
          listing: true,
          buyer: true,
          seller: true,
        },
      });
      if (!tx) return;
      const details = {
        listingTitle: tx.listing.title,
        listingId: tx.listingId,
        transactionId: txId,
        buyerEmail: tx.buyer.email,
        buyerName: [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') || 'Buyer',
        sellerEmail: tx.seller.email,
        sellerName: [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') || 'Seller',
        listingPrice: tx.listingPrice,
        commissionZar: tx.commissionZar,
        processingFee: tx.processingFee,
        buyerTotal: tx.buyerTotal,
        sellerPayout: tx.sellerPayout,
        passFeeToBuyer: tx.passFeeToBuyer,
        shippingMethod: tx.shippingMethod,
      };
      await Promise.all([
        this.notifications.orderConfirmedBuyer(details),
        this.notifications.newSaleSeller(details),
      ]);
    } catch (err) {
      this.logger.error(`sendSaleNotifications failed for ${txId}: ${(err as Error).message}`);
    }
  }

  private async sendDispatchedNotification(txId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        include: { listing: true, buyer: true },
      });
      if (!tx) return;
      await this.notifications.itemDispatched({
        listingTitle: tx.listing.title,
        transactionId: txId,
        buyerEmail: tx.buyer.email,
        buyerName: [tx.buyer.firstName, tx.buyer.lastName].filter(Boolean).join(' ') || 'Buyer',
        trackingReference: tx.trackingReference,
        shippingMethod: tx.shippingMethod,
      });
    } catch (err) {
      this.logger.error(`sendDispatchedNotification failed for ${txId}: ${(err as Error).message}`);
    }
  }

  private async sendReleasedNotification(txId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        include: { listing: true, seller: true },
      });
      if (!tx) return;
      await this.notifications.paymentReleasedSeller({
        sellerEmail: tx.seller.email,
        sellerName: [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') || 'Seller',
        listingTitle: tx.listing.title,
        sellerPayout: tx.sellerPayout,
        transactionId: txId,
      });
    } catch (err) {
      this.logger.error(`sendReleasedNotification failed for ${txId}: ${(err as Error).message}`);
    }
  }

  private validateShipping(isFirearm: boolean, method: ShippingMethod) {
    if (isFirearm && method !== 'DEALER_TRANSFER') {
      throw new BadRequestException(
        'Firearms must use DEALER_TRANSFER shipping — no exceptions',
      );
    }
    if (!isFirearm && method === 'DEALER_TRANSFER') {
      throw new BadRequestException('DEALER_TRANSFER is only for firearm listings');
    }
  }
}
