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
import { ListingStatus, Province, ShippingMethod } from '@prisma/client';
import { KycService } from '../kyc/kyc.service';
import { ShippingService } from '../shipping/shipping.service';
import { TrackingService } from '../shipping/tracking.service';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeCalculator,
    private readonly notifications: NotificationsService,
    private readonly peach: PeachService,
    private readonly kyc: KycService,
    private readonly shipping: ShippingService,
    private readonly tracking: TrackingService,
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
    if (listing.sellerId === buyer.id) {
      throw new BadRequestException('Sellers cannot buy their own listings');
    }

    // ---- Offer-based checkout (TAKE_A_SHOT) ----
    let offerRecord: { id: string; offerAmount: number; counterAmount: number | null; buyerId: string; status: string } | null = null;
    if (dto.offerId) {
      const rawOffer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
      if (!rawOffer) throw new NotFoundException('Offer not found');
      if (rawOffer.buyerId !== buyer.id) throw new ForbiddenException('Offer does not belong to you');
      if (rawOffer.status !== 'ACCEPTED') throw new BadRequestException('Offer is not accepted');
      if (listing.listingType !== 'TAKE_A_SHOT') throw new BadRequestException('Offer checkout requires a TAKE_A_SHOT listing');
      offerRecord = rawOffer;
    } else {
      if (listing.status !== 'ACTIVE') {
        throw new BadRequestException('Listing is no longer available');
      }
      if (listing.listingType !== 'BUY_NOW') {
        throw new BadRequestException('Only BUY_NOW listings support direct checkout');
      }
    }
    // ----

    // Enforce shipping routing rules: legal class (firearm vs not) AND
    // the seller's offered methods (a subset of the legal options).
    this.validateShipping(
      listing.isFirearm,
      listing.shippingMethods,
      dto.shippingMethod,
    );

    // If dealer transfer, verify the dealer exists and is active
    if (dto.shippingMethod === 'DEALER_TRANSFER' && dto.dealerId) {
      const dealer = await this.prisma.dealer.findUnique({ where: { id: dto.dealerId } });
      if (!dealer || !dealer.isActive) throw new NotFoundException('Dealer not found or inactive');
    }

    // The settled price: for offers use counter (if accepted) or original offer, else listing price
    const agreedPrice = offerRecord
      ? (offerRecord.counterAmount ?? offerRecord.offerAmount)
      : (listing.price ?? 0);
    if (!agreedPrice) throw new BadRequestException('Could not determine listing price');

    const isTopSeller = listing.seller.sellerTier === 'TOP_SELLER';

    // Live shipping quote — re-fetched server-side so the buyer can't
    // tamper with the priceCents the frontend showed them. The same
    // quote endpoint the checkout UI hit pre-Pay runs again here. For
    // firearm transfers (DEALER_TRANSFER / PRIVATE_ARRANGE) there's no
    // courier rate; shippingCost = 0 and we skip the quote call.
    let shippingCostCents = 0;
    let shippingServiceCode: string | null = null;
    if (
      dto.shippingMethod === 'PUDO' ||
      dto.shippingMethod === 'TCG'
    ) {
      const quote = await this.shipping.quoteForListing({
        listingId: listing.id,
        shippingMethod: dto.shippingMethod,
        toLockerId: dto.pudoPickupLockerId,
        deliveryAddress:
          dto.shippingMethod === 'TCG' && dto.deliveryAddress
            ? {
                streetAddress: dto.deliveryAddress.streetAddress,
                suburb: dto.deliveryAddress.suburb,
                city: dto.deliveryAddress.city,
                postalCode: dto.deliveryAddress.postalCode,
                // DTO has province as string; Prisma's Province enum
                // is a subset of those strings, so we cast. The rate
                // helper guards against invalid values via its zone
                // lookup (unknown enum → undefined, throws).
                province: dto.deliveryAddress.province as Province,
                // Required for D2D rate distance maths. If the frontend
                // didn't capture lat/lng on the form, quoteForListing
                // throws a clean BadRequestException.
                lat: (dto.deliveryAddress as { lat?: number }).lat ?? 0,
                lng: (dto.deliveryAddress as { lng?: number }).lng ?? 0,
              }
            : undefined,
      });
      shippingCostCents = quote.priceCents;
      shippingServiceCode = quote.serviceCode;
    }

    const {
      listingPrice,
      shippingCost,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout,
    } = this.fees.breakdown(
      agreedPrice,
      listing.passFeeToBuyer,
      isTopSeller,
      shippingCostCents,
    );

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
        shippingCost,
        shippingServiceCode,
        passFeeToBuyer: listing.passFeeToBuyer,
        buyerTotal,
        sellerPayout,
        shippingMethod: dto.shippingMethod,
        pudoPickupLockerId: dto.pudoPickupLockerId,
        deliveryAddress: dto.deliveryAddress ? { ...dto.deliveryAddress } : undefined,
        dealerId: dto.dealerId,
        // PRIVATE_ARRANGE consent landed via DTO. We stamp the
        // timestamp here (not at markPaid time) because the consent is
        // given at checkout, regardless of whether Peach captures the
        // card. The immediate-payout branch in markPaid still verifies
        // this column is set before releasing funds — defence in depth.
        privateArrangeAcceptedAt:
          dto.shippingMethod === 'PRIVATE_ARRANGE' && dto.privateArrangeConsent
            ? new Date()
            : null,
      },
    });

    // KYC TRIGGER — if this seller hasn't been verified yet, fire the
    // VerifyNow prompt (SMS + email + in-app banner flag). idempotent:
    // repeat sales on the same unverified seller don't re-notify.
    // Fire-and-forget so a slow SMS gateway never blocks the buyer's
    // checkout redirect.
    if (listing.seller.kycStatus !== 'VERIFIED') {
      void this.kyc
        .triggerSellerVerification(listing.sellerId)
        .catch((err) =>
          this.logger.warn(
            `triggerSellerVerification failed for ${listing.sellerId}: ${(err as Error).message}`,
          ),
        );
    }

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

    // Store checkout ID and mark offer as CONVERTED if applicable
    const [updated] = await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: tx.id },
        data: { peachCheckoutId: peachCheckout.checkoutId },
      }),
      ...(offerRecord
        ? [this.prisma.offer.update({
            where: { id: offerRecord.id },
            data: { status: 'CONVERTED', transactionId: tx.id },
          })]
        : []),
    ]);

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
  // Exposed to webhook controller so it can verify before processing.
  // ------------------------------------------------------------------
  verifyPeachWebhook(rawBody: string, signature: string | undefined): boolean {
    return this.peach.verifyWebhookSignature(rawBody, signature);
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
    // INTERNAL timeline entry — fires immediately so the buyer sees
    // "Seller dispatched" before any carrier event lands.
    void this.tracking.recordInternal(transactionId, 'SELLER_DISPATCHED');
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
        // Username surfaces in the order list UI per platform policy
        // (no real-name display). firstName/lastName retained for any
        // internal flow that still needs the real name.
        buyer: { select: { username: true, firstName: true, lastName: true } },
        seller: { select: { username: true, firstName: true, lastName: true } },
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
        // Phone + email pulled in so the PRIVATE_ARRANGE contact-reveal
        // card on the order page has the data it needs. We DO NOT
        // expose contact details indiscriminately — the conditional
        // strip below blanks them out for non-PA orders so they
        // never leak through the API. The order page is already
        // auth-gated to buyer + seller, but defence in depth.
        buyer: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        seller: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        dealer: true,
      },
    });

    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== user.id && tx.sellerId !== user.id) {
      throw new ForbiddenException('Not authorised');
    }

    // Contact-detail strip — phone + the seller-side email are only
    // revealed when this is a paid PRIVATE_ARRANGE transaction. For
    // any other shipping method we blank them so a curious buyer
    // can't pluck the seller's phone out of the JSON.
    const isPaidPrivateArrange =
      tx.shippingMethod === 'PRIVATE_ARRANGE' &&
      !!tx.privateArrangeAcceptedAt &&
      tx.paymentStatus === 'RELEASED';
    if (!isPaidPrivateArrange) {
      // The buyer's own row is theirs — keep their phone visible to
      // them; same for the seller. We only blank the OTHER party's
      // details from each side.
      if (tx.buyerId !== user.id) tx.buyer.phone = null;
      if (tx.sellerId !== user.id) {
        tx.seller.phone = null;
        // The seller's email is private to the platform on the
        // non-PA path; blank it before the row leaves the API.
        // Email column is non-null in the User model so we cast
        // through unknown to clear it on the response object only.
        (tx.seller as unknown as { email: string | null }).email = null;
      }
    }

    return tx;
  }

  // ------------------------------------------------------------------
  // Buyer confirms delivery → releases payment, increments totalSales
  // ------------------------------------------------------------------
  async confirmDelivery(transactionId: string, buyerClerkId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, listing: { select: { isFirearm: true } } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyer.clerkId !== buyerClerkId) throw new ForbiddenException('Only the buyer can confirm delivery');
    if (tx.paymentStatus !== 'HELD') throw new BadRequestException('Payment is not in HELD state');
    if (tx.confirmedDeliveryAt) throw new BadRequestException('Delivery already confirmed');

    // Firearm DEALER_TRANSFER gates payout on the SAPS 534 verification
    // having been APPROVED (either automatically by Claude vision or
    // by admin override). The buyer can still click confirm-delivery
    // but we won't release funds until the dealer paperwork has passed.
    // PRIVATE_ARRANGE skips this — funds are already released at
    // payment capture (see maybeImmediatePayout).
    if (
      tx.listing.isFirearm &&
      tx.shippingMethod === 'DEALER_TRANSFER' &&
      tx.dealerVerificationStatus !== 'APPROVED'
    ) {
      throw new BadRequestException(
        'Dealer stock-in verification has not been approved yet. The seller must upload the SAPS 534 + stock register + firearm photos before payment can release. Status: ' +
          (tx.dealerVerificationStatus ?? 'NOT_STARTED'),
      );
    }

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
    // Two INTERNAL timeline rows back-to-back: the buyer's explicit
    // confirmation and the resulting payout. The polling cron's PUDO
    // events may also land a COLLECTED_BY_BUYER row but we mark this
    // one with its own status so the timeline distinguishes "buyer
    // pressed the button" from "Pudo says the locker opened".
    void this.tracking.recordInternal(transactionId, 'BUYER_CONFIRMED_DELIVERY', {
      occurredAt: now,
    });
    void this.tracking.recordInternal(transactionId, 'PAYOUT_RELEASED', {
      occurredAt: new Date(now.getTime() + 1),
    });
    void this.sendReleasedNotification(transactionId);
    return { released: true };
  }

  // ------------------------------------------------------------------
  // Buyer raises a dispute (item damaged / wrong / never arrived / other)
  // ------------------------------------------------------------------
  //
  // Only allowed while payment is HELD AND the seller has already
  // dispatched (no point disputing a seller who hasn't even shipped).
  // Sets paymentStatus → DISPUTED which:
  //   - pauses the dispatch SLA auto-refund cron
  //   - surfaces in the admin command-center "disputed payments" card
  //   - shows up in admin analytics disputeRate
  //   - blocks confirm-delivery (already gated on paymentStatus = HELD)
  // The admin resolves it manually via the admin transaction dossier
  // (force-release to seller OR refund to buyer + reason).
  async raiseDispute(
    transactionId: string,
    buyerClerkId: string,
    reason: 'DAMAGED' | 'WRONG_ITEM' | 'NEVER_ARRIVED' | 'OTHER',
    details: string,
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, seller: true, listing: { select: { title: true } } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyer.clerkId !== buyerClerkId) {
      throw new ForbiddenException('Only the buyer can raise a dispute');
    }
    if (tx.paymentStatus !== 'HELD') {
      throw new BadRequestException(
        'Disputes can only be raised while the payment is held. This transaction is already ' +
          tx.paymentStatus.toLowerCase().replace(/_/g, ' ') + '.',
      );
    }
    if (!tx.dispatchedAt) {
      throw new BadRequestException(
        'Disputes can only be raised after the seller has dispatched. ' +
          'If the seller has not dispatched within 48 hours of payment, the system will automatically refund you.',
      );
    }
    if (tx.confirmedDeliveryAt) {
      throw new BadRequestException(
        'You have already confirmed delivery for this transaction. ' +
          'Please contact support if there is an issue with the item.',
      );
    }
    const trimmedDetails = (details ?? '').trim();
    if (trimmedDetails.length < 10) {
      throw new BadRequestException(
        'Please describe the issue in at least 10 characters so the admin team can investigate.',
      );
    }

    // Combine reason + details into a single adminNote — operator sees
    // both on the admin dossier. The reason enum stays machine-readable
    // for future filtering.
    const note = `[BUYER DISPUTE: ${reason}] ${trimmedDetails}`;

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        paymentStatus: 'DISPUTED',
        adminNote: tx.adminNote ? `${tx.adminNote}\n\n${note}` : note,
      },
    });

    // Timeline row so the buyer + seller both see when the dispute
    // landed (admin dossier renders the full timeline too).
    void this.tracking.recordInternal(transactionId, 'BUYER_RAISED_DISPUTE', {
      occurredAt: new Date(),
      message: `Buyer raised dispute: ${reason.replace(/_/g, ' ').toLowerCase()}`,
    });

    // Raise an admin alert — urgent because disputes need human eyes
    // within hours, not days.
    void this.prisma.adminAlert.create({
      data: {
        type: 'BUYER_DISPUTE_RAISED',
        referenceId: transactionId,
        context: `${reason.replace(/_/g, ' ')} — ${tx.listing.title} — buyer @${tx.buyer.username ?? 'anon'}: ${trimmedDetails.slice(0, 200)}`,
        urgent: true,
      },
    }).catch((err) => {
      this.logger.warn(`Admin alert insert failed for dispute on ${transactionId}: ${(err as Error).message}`);
    });

    this.logger.log(`Transaction ${transactionId} disputed by buyer — reason ${reason}`);

    return { disputed: true };
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

    // Append an INTERNAL milestone row so the buyer/seller timeline
    // starts with a "Payment received" marker BEFORE the seller marks
    // dispatch. Fire-and-forget — tracking is non-critical.
    void this.tracking.recordInternal(txId, 'PAYMENT_RECEIVED');

    // PRIVATE_ARRANGE — buyer explicitly waived payment protection at
    // checkout (privateArrangeAcceptedAt is set). Release funds
    // immediately + reveal contact details to both parties so they
    // can coordinate the SAPS dealer meet. We re-read the row here
    // because the txn above was a single statement that hasn't
    // returned values into local scope, and we need shippingMethod +
    // consent stamp to decide.
    void this.maybeImmediatePayout(txId);

    // Fire-and-forget notifications
    void this.sendSaleNotifications(txId);
  }

  // ------------------------------------------------------------------
  // PRIVATE_ARRANGE branch — runs after markPaid lands. Releases
  // funds immediately, increments totalSales, and triggers the
  // contact-reveal notification. Skips if the row isn't a
  // PRIVATE_ARRANGE or if the consent stamp is missing (defence in
  // depth — a missing stamp means the buyer didn't go through the
  // consent screen so we MUST not auto-release).
  // ------------------------------------------------------------------
  private async maybeImmediatePayout(txId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: {
          id: true,
          shippingMethod: true,
          paymentStatus: true,
          privateArrangeAcceptedAt: true,
          sellerId: true,
        },
      });
      if (!tx) return;
      if (tx.shippingMethod !== 'PRIVATE_ARRANGE') return;
      if (!tx.privateArrangeAcceptedAt) {
        this.logger.warn(
          `Transaction ${txId} is PRIVATE_ARRANGE but missing consent stamp — not auto-releasing`,
        );
        return;
      }
      if (tx.paymentStatus !== 'HELD') return; // already moved

      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.transaction.update({
          where: { id: txId },
          data: {
            paymentStatus: 'RELEASED',
            releasedAt: now,
          },
        }),
        this.prisma.user.update({
          where: { id: tx.sellerId },
          data: { totalSales: { increment: 1 } },
        }),
      ]);

      this.logger.log(
        `Transaction ${txId} PRIVATE_ARRANGE — payment released immediately, contact details revealed`,
      );

      // Two timeline rows so the buyer/seller order page shows the
      // waiver + payout chain rather than just an unexplained jump.
      void this.tracking.recordInternal(txId, 'PRIVATE_ARRANGE_WAIVER', {
        occurredAt: now,
        message:
          'Buyer waived payment protection — payment released to seller immediately',
      });
      void this.tracking.recordInternal(txId, 'PAYOUT_RELEASED', {
        occurredAt: new Date(now.getTime() + 1),
      });

      // Notify both parties with each other's contact details. Two
      // separate emails (buyer → gets seller's; seller → gets
      // buyer's) so we never leak each other's PII via reply-all.
      void this.sendPrivateArrangeContactReveal(txId);
    } catch (err) {
      this.logger.error(
        `maybeImmediatePayout failed for ${txId}: ${(err as Error).message}`,
      );
    }
  }

  private async sendPrivateArrangeContactReveal(txId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        include: { listing: true, buyer: true, seller: true },
      });
      if (!tx) return;
      await this.notifications.privateArrangeContactReveal({
        listingTitle: tx.listing.title,
        transactionId: txId,
        buyer: {
          email: tx.buyer.email,
          firstName: tx.buyer.firstName,
          lastName: tx.buyer.lastName,
          phone: tx.buyer.phone,
        },
        seller: {
          email: tx.seller.email,
          firstName: tx.seller.firstName,
          lastName: tx.seller.lastName,
          phone: tx.seller.phone,
        },
        sellerPayout: tx.sellerPayout,
      });
    } catch (err) {
      this.logger.error(
        `sendPrivateArrangeContactReveal failed for ${txId}: ${(err as Error).message}`,
      );
    }
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
        buyerPhone: tx.buyer.phone,
        sellerEmail: tx.seller.email,
        sellerName: [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') || 'Seller',
        sellerPhone: tx.seller.phone,
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
        buyerPhone: tx.buyer.phone,
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
        sellerPhone: tx.seller.phone,
        listingTitle: tx.listing.title,
        sellerPayout: tx.sellerPayout,
        transactionId: txId,
      });
    } catch (err) {
      this.logger.error(`sendReleasedNotification failed for ${txId}: ${(err as Error).message}`);
    }
  }

  private validateShipping(
    isFirearm: boolean,
    sellerOffered: ShippingMethod[],
    chosen: ShippingMethod,
  ) {
    // 1. Legal class — firearms can only use dealer transfer OR a private
    //    arrangement (which still requires both parties to visit a dealer
    //    in person, just without a pre-picked one). Non-firearms can't
    //    touch either of those.
    const firearmLegal: ShippingMethod[] = ['DEALER_TRANSFER', 'PRIVATE_ARRANGE'];
    const nonFirearmLegal: ShippingMethod[] = ['PUDO', 'TCG'];
    if (isFirearm && !firearmLegal.includes(chosen)) {
      throw new BadRequestException(
        'Firearms must ship via DEALER_TRANSFER or PRIVATE_ARRANGE',
      );
    }
    if (!isFirearm && !nonFirearmLegal.includes(chosen)) {
      throw new BadRequestException(
        'Non-firearms ship via PUDO or TCG only',
      );
    }
    // 2. Seller's offered subset — if the seller didn't pick this method
    //    in the Sell form, the buyer can't choose it. Empty array means
    //    "any legal option" for backwards compat with older listings.
    if (sellerOffered.length > 0 && !sellerOffered.includes(chosen)) {
      throw new BadRequestException(
        `Seller is not offering ${chosen.replace('_', ' ')} for this listing`,
      );
    }
  }
}
