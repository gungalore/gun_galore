import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeeCalculator } from './fee.calculator';
import { PeachService, PeachPaymentResult } from './peach.service';
import { StitchService, StitchPaymentResult } from './stitch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListingStatus, Province, ShippingMethod } from '@prisma/client';
import { KycService } from '../kyc/kyc.service';
import { ShippingService } from '../shipping/shipping.service';
import { TrackingService } from '../shipping/tracking.service';
import { Inject, forwardRef } from '@nestjs/common';
import { ActionTokensService } from '../actions/action-tokens.service';

// TOK-7 — accept→dispatch state machine deadlines.
// Spec (operator-confirmed 2026-05-27):
//   - 48h from payment for the seller to ACCEPT the transaction
//   - 5 days from acceptance for the seller to DISPATCH
//   - 48h no-accept: escalate to admin queue (no auto-refund)
//   - 5d no-dispatch: existing auto-refund + strike flow (unchanged)
export const ACCEPT_DEADLINE_HOURS = 48;
export const DISPATCH_DEADLINE_DAYS = 5;

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeCalculator,
    private readonly notifications: NotificationsService,
    private readonly peach: PeachService,
    private readonly stitch: StitchService,
    private readonly kyc: KycService,
    private readonly shipping: ShippingService,
    private readonly tracking: TrackingService,
    // forwardRef: ActionTokensModule imports PaymentsModule for
    // TransactionsService (so the /actions/:token/accept-transaction
    // endpoint can call acceptTransaction), and PaymentsModule needs
    // ActionTokensService here to mint the TRANSACTION_ACCEPT token
    // when sending the post-payment SMS. Circular by design — Nest
    // handles it with two forwardRefs.
    @Inject(forwardRef(() => ActionTokensService))
    private readonly tokens: ActionTokensService,
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

    // Reserve the listing ATOMICALLY. Only ONE buyer can flip it from
    // ACTIVE → PAYMENT_PENDING. This is the double-sell guard: for
    // TAKE_A_SHOT listings multiple offers can be ACCEPTED at once, so
    // without a conditional reserve, N buyers could each create a
    // checkout and pay for the same single item (double-charge). The
    // BUY_NOW read-check above is racy on its own; this makes both paths
    // correct. count===0 means another buyer already reserved it or it
    // has sold.
    const reserve = await this.prisma.listing.updateMany({
      where: { id: listing.id, status: ListingStatus.ACTIVE },
      data: { status: ListingStatus.PAYMENT_PENDING },
    });
    if (reserve.count === 0) {
      throw new BadRequestException(
        'This item is no longer available — another buyer is completing checkout, or it has already sold.',
      );
    }

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

    // Create the Stitch Express checkout (hosted payment link). We pass
    // the BASE complete URL (no txId) because Stitch matches the
    // redirect against a registered set; the txId rides back via the
    // browser (localStorage) and, once the webhook lands, via
    // merchantReference. The buyer's own name is fine to send to the
    // gateway (it's their card payment, not exposed to other users).
    const resultUrl = `${frontendUrl}/checkout/complete`;
    const payerName =
      [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') ||
      buyer.username ||
      undefined;
    let stitchCheckout;
    try {
      stitchCheckout = await this.stitch.createCheckout({
        amountZarCents: buyerTotal,
        merchantTransactionId: tx.id,
        shopperResultUrl: resultUrl,
        shopperName: payerName,
        shopperEmail: buyer.email,
      });
    } catch (err) {
      // Roll back the listing reservation if the gateway call fails.
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ACTIVE },
      });
      await this.prisma.transaction.delete({ where: { id: tx.id } });
      throw new BadRequestException(`Payment checkout failed: ${(err as Error).message}`);
    }

    // Persist the Stitch payment id (reusing the peachCheckoutId column
    // during the Peach→Stitch transition — no schema change) and mark
    // the offer CONVERTED if this was an offer checkout.
    const [updated] = await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: tx.id },
        data: { peachCheckoutId: stitchCheckout.paymentId },
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
      // Generic fields the frontend redirects on. paymentId carries the
      // `mock-` prefix when Stitch isn't configured (dev), which the UI
      // uses to render the test-mode card instead of redirecting.
      paymentId: stitchCheckout.paymentId,
      redirectUrl: stitchCheckout.redirectUrl,
      provider: 'stitch' as const,
      breakdown: { listingPrice, commissionZar, processingFee, buyerTotal, sellerPayout },
    };
  }

  // ------------------------------------------------------------------
  // Called from the result page — verify payment with Stitch
  // ------------------------------------------------------------------
  // The Stitch payment id was stored on peachCheckoutId at create() time.
  // We look the tx up by its own id, read ITS stored payment id, and query
  // Stitch for that payment — so the gateway result is bound to this exact
  // transaction by construction (an attacker who controls only the URL's
  // transactionId can never point it at someone else's payment). The
  // amount check in markPaid (Stitch echoes data.payment.amount in cents)
  // is the remaining money-state guard.
  //
  // We deliberately DO NOT revert the listing on a non-success here. The
  // Stitch payment OBJECT only exists once captured, so a "not found yet"
  // simply means the buyer hasn't finished (or an EFT/PayShap is still
  // settling); reverting could double-sell a still-settling order.
  // Abandoned PAYMENT_PENDING listings are freed by the webhook/reconcile
  // path (deferred) after the 24h payment-link expiry.
  //
  // `_resourcePath` is the legacy Peach param — accepted for backward
  // compatibility with the existing endpoint shape but unused.
  async verifyResult(transactionId: string, _resourcePath?: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { listing: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    // Already processed — idempotent
    if (tx.paidAt) return { success: true, alreadyProcessed: true };

    const stitchPaymentId = tx.peachCheckoutId;
    if (!stitchPaymentId) {
      throw new BadRequestException('No payment reference on this transaction');
    }

    try {
      const status = await this.stitch.getPaymentStatus(stitchPaymentId);
      if (status.isSuccess) {
        // Map the Stitch result into the gateway-result shape markPaid
        // binds on. merchantTransactionId is set to tx.id (bound by
        // construction — see above) so a missing merchantReference echo
        // can't break a genuine capture; the amount is the real guard.
        const result: PeachPaymentResult = {
          paymentId: status.paymentId,
          resultCode: status.status,
          amount: status.amountCents,
          currency: 'ZAR',
          merchantTransactionId: tx.id,
          isSuccess: true,
        };
        await this.markPaid(tx.id, result, tx.listing, tx.buyerTotal);
        return { success: true };
      }
      // Not captured (yet) — leave the listing reserved; do not revert.
      return { success: false, resultCode: status.status };
    } catch (err) {
      this.logger.error('Stitch verify failed', err);
      throw new BadRequestException('Payment verification failed');
    }
  }

  // ------------------------------------------------------------------
  // Exposed to the webhook controller — verify the Svix signature.
  // ------------------------------------------------------------------
  verifyStitchWebhook(
    rawBody: string,
    headers: { id?: string; timestamp?: string; signature?: string },
  ): boolean {
    return this.stitch.verifyWebhookSignature(rawBody, headers);
  }

  // ------------------------------------------------------------------
  // Called from the Stitch webhook (payment.paid). Confirms the matching
  // transaction even when the buyer closed the tab before returning to
  // /checkout/complete (or paid by async EFT). We re-fetch authoritative
  // status from Stitch — never trusting the webhook body's amount — and
  // bind it in markPaid. Never reverts on a non-success (a still-settling
  // payment could be double-sold); the webhook must always 200.
  // ------------------------------------------------------------------
  async handleStitchWebhook(body: Record<string, unknown>) {
    const evt = this.stitch.parseWebhookEvent(body);
    if (!evt.paymentId && !evt.merchantReference) {
      this.logger.warn('Stitch webhook: no paymentId/merchantReference');
      return;
    }

    // The Stitch payment id is stored on peachCheckoutId at create() time.
    // Match on that first; fall back to merchantReference (= our tx id).
    const tx = await this.prisma.transaction.findFirst({
      where: evt.paymentId
        ? { peachCheckoutId: evt.paymentId }
        : { id: evt.merchantReference },
      include: { listing: true },
    });
    if (!tx) {
      this.logger.warn(
        `Stitch webhook: no transaction for payment ${evt.paymentId ?? evt.merchantReference}`,
      );
      return;
    }
    if (tx.paidAt) {
      this.logger.log(`Stitch webhook: transaction ${tx.id} already processed`);
      return;
    }

    const paymentId = tx.peachCheckoutId ?? evt.paymentId;
    if (!paymentId) {
      this.logger.warn(`Stitch webhook: transaction ${tx.id} has no payment id`);
      return;
    }

    let status: StitchPaymentResult;
    try {
      status = await this.stitch.getPaymentStatus(paymentId);
    } catch (err) {
      this.logger.error(
        `Stitch webhook: status fetch failed for ${paymentId}: ${(err as Error).message}`,
      );
      return;
    }
    if (!status.isSuccess) {
      this.logger.warn(
        `Stitch webhook: payment ${paymentId} not successful (status ${status.status})`,
      );
      return;
    }

    // markPaid binds the amount; merchantTransactionId = tx.id (bound by
    // construction, same as the verify-result path). Catch a mismatch so
    // the always-200 webhook surfaces it as an alert, not a 500.
    try {
      await this.markPaid(
        tx.id,
        {
          paymentId: status.paymentId,
          resultCode: status.status,
          amount: status.amountCents,
          currency: 'ZAR',
          merchantTransactionId: tx.id,
          isSuccess: true,
        },
        tx.listing,
        tx.buyerTotal,
      );
    } catch (err) {
      this.logger.error(
        `Stitch webhook: markPaid rejected for ${tx.id}: ${(err as Error).message}`,
      );
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'STITCH_WEBHOOK_MARKPAID_REJECTED',
            referenceId: tx.id,
            urgent: true,
            context: `Webhook success for ${tx.id} but markPaid rejected: ${(err as Error).message}. Paid amount=${status.amountCents}c.`,
          },
        })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------
  // Seller confirms item dispatched
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Seller accepts the transaction (TOK-7)
  // ------------------------------------------------------------------
  // First step of the two-step seller workflow. Buyer paid; seller has
  // ACCEPT_DEADLINE_HOURS to acknowledge they'll handle it. On accept
  // we stamp `acceptedAt` and pre-compute `dispatchDeadlineAt` so the
  // UI countdown chip can read one field + the dispatch cron can do
  // an indexed scan on the deadline.
  //
  // Idempotent — already-accepted txs just return without re-stamping.
  // (Important because the SMS link can be tapped multiple times by
  // accident; we don't want to extend the deadline by re-clicking.)
  async acceptTransaction(transactionId: string, sellerClerkId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: { select: { title: true } },
        buyer: {
          select: {
            email: true,
            firstName: true,
            phone: true,
            username: true,
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const seller = await this.prisma.user.findUnique({
      where: { clerkId: sellerClerkId },
    });
    if (!seller || tx.sellerId !== seller.id) {
      throw new ForbiddenException('Not authorised');
    }
    if (!tx.paidAt) {
      throw new BadRequestException('Payment not confirmed yet');
    }
    if (tx.rejectedAt) {
      throw new BadRequestException('Transaction already rejected');
    }
    if (tx.acceptedAt) {
      // Idempotent — already-accepted is a successful no-op.
      return tx;
    }

    const acceptedAt = new Date();
    const dispatchDeadlineAt = new Date(
      acceptedAt.getTime() + DISPATCH_DEADLINE_DAYS * 24 * 60 * 60 * 1000,
    );

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { acceptedAt, dispatchDeadlineAt },
    });

    // Timeline + notifications — fire-and-forget.
    void this.tracking.recordInternal(transactionId, 'SELLER_ACCEPTED');
    void this.notifications.resolveByEntity('transaction', transactionId);
    // Buyer notification — "Seller accepted, dispatch within 5d".
    // Closes the "Awaiting seller accept" loop on the buyer side.
    void this.notifications.saleAcceptedBuyer({
      buyerEmail: tx.buyer.email,
      buyerName:
        tx.buyer.firstName ?? tx.buyer.username ?? 'there',
      buyerPhone: tx.buyer.phone,
      listingTitle: tx.listing.title,
      transactionId: tx.id,
      dispatchDeadlineAt,
    });

    this.logger.log(
      `Transaction ${transactionId} accepted by seller ${seller.id}; dispatch deadline ${dispatchDeadlineAt.toISOString()}`,
    );
    return updated;
  }

  // ------------------------------------------------------------------
  // Seller rejects the transaction (TOK-7 Phase 2)
  // ------------------------------------------------------------------
  // Alternative to accept — the seller can't or won't fulfil. Triggers:
  //   1. Peach refund of buyerTotal
  //   2. Transaction.paymentStatus = REFUNDED + rejectedAt/Reason stamped
  //   3. Listing reactivated (status ACTIVE, soldAt cleared) so other
  //      buyers can pick it up again
  //   4. Buyer notification (saleRejectedBuyer — SMS + email + inbox)
  //   5. Tracking timeline entry SELLER_REJECTED for audit
  //
  // Reason is required (operator-confirmed) — surfaces to the buyer in
  // the rejection notification and to admin for trust-safety review.
  //
  // No strike on the seller for rejecting (unlike auto-refund-no-dispatch
  // which IS a strike). Rejecting up-front is the honest move; we want
  // sellers to do this rather than ghost the transaction.
  async rejectTransaction(
    transactionId: string,
    sellerClerkId: string,
    reason: string,
  ) {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 3) {
      throw new BadRequestException('Reason is required (min 3 characters)');
    }
    if (trimmedReason.length > 500) {
      throw new BadRequestException('Reason is too long (max 500 characters)');
    }

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        listing: { select: { id: true, title: true } },
        buyer: {
          select: {
            email: true,
            firstName: true,
            phone: true,
            username: true,
          },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const seller = await this.prisma.user.findUnique({
      where: { clerkId: sellerClerkId },
    });
    if (!seller || tx.sellerId !== seller.id) {
      throw new ForbiddenException('Not authorised');
    }
    if (!tx.paidAt) {
      throw new BadRequestException('Payment not confirmed yet');
    }
    if (tx.acceptedAt) {
      throw new BadRequestException(
        'Transaction already accepted — cannot reject. Contact support to refund.',
      );
    }
    if (tx.rejectedAt) {
      // Idempotent — already-rejected is a successful no-op.
      return tx;
    }
    if (tx.dispatchedAt) {
      throw new BadRequestException('Already dispatched — cannot reject.');
    }

    // Fire the Stitch refund first — only stamp rejectedAt if it
    // succeeded, so an admin can retry on failure rather than the buyer
    // being stuck without a refund AND the listing reactivated.
    // peachPaymentId holds the Stitch payment id (column reused during
    // the Peach→Stitch transition).
    const refundRes = tx.peachPaymentId
      ? await this.stitch.refundPayment(tx.peachPaymentId, tx.buyerTotal)
      : { success: true, resultCode: 'NO_PAYMENT_ID' };

    if (!refundRes.success) {
      this.logger.warn(
        `Reject failed for ${transactionId}: Stitch refund failed (${refundRes.resultCode}) — raising admin alert`,
      );
      await this.prisma.adminAlert.create({
        data: {
          type: 'SALE_REJECT_REFUND_FAILED',
          referenceId: transactionId,
          urgent: true,
          context: `Seller tried to reject sale; Stitch refund failed: ${refundRes.resultCode}. Buyer still owed ${tx.buyerTotal} cents.`,
        },
      });
      throw new BadRequestException(
        'Refund failed — support has been alerted and will resolve manually within 24h.',
      );
    }

    // Atomic state change — only after refund succeeded.
    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          rejectedAt: new Date(),
          rejectedReason: trimmedReason,
          paymentStatus: 'REFUNDED',
          releasedAt: null,
        },
      }),
      this.prisma.listing.update({
        where: { id: tx.listingId },
        data: { status: 'ACTIVE', soldAt: null },
      }),
    ]);

    // Timeline + buyer notification + clear seller's accept-pending
    // inbox row. Fire-and-forget; UI feedback already returned to the
    // seller via the controller's success response.
    void this.tracking.recordInternal(transactionId, 'SELLER_REJECTED', {
      message: `Seller rejected: ${trimmedReason}`,
    });
    void this.notifications.resolveByEntity('transaction', transactionId);
    void this.notifications.saleRejectedBuyer({
      buyerEmail: tx.buyer.email,
      buyerName:
        tx.buyer.firstName ?? tx.buyer.username ?? 'there',
      buyerPhone: tx.buyer.phone,
      listingTitle: tx.listing.title,
      listingId: tx.listingId,
      transactionId: tx.id,
      buyerTotal: tx.buyerTotal,
      reason: trimmedReason,
    });

    this.logger.log(
      `Transaction ${transactionId} REJECTED by seller ${seller.id} (reason: ${trimmedReason.slice(0, 80)})`,
    );
    return this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
  }

  // ------------------------------------------------------------------
  // 48h accept-escalation sweep (TOK-7 Phase 2)
  // ------------------------------------------------------------------
  // Cron-invoked. Finds transactions past the accept deadline that the
  // seller hasn't actioned (no accept, no reject) and flips
  // acceptEscalatedAt so they surface on the admin "stalled sales"
  // queue. We do NOT auto-refund — admin decides per-case (give the
  // seller more time, or refund the buyer).
  //
  // Idempotent via acceptEscalatedAt — already-escalated rows are
  // skipped on subsequent passes.
  async escalateStaleAccepts(): Promise<{ scanned: number; escalated: number }> {
    const now = new Date();
    const stale = await this.prisma.transaction.findMany({
      where: {
        acceptDeadlineAt: { lte: now },
        acceptedAt: null,
        rejectedAt: null,
        acceptEscalatedAt: null,
        paymentStatus: 'HELD',
      },
      include: {
        listing: { select: { title: true } },
        seller: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
      take: 50,
    });

    let escalated = 0;
    for (const tx of stale) {
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { acceptEscalatedAt: new Date() },
        });
        await this.prisma.adminAlert.create({
          data: {
            type: 'SALE_ACCEPT_STALLED',
            referenceId: tx.id,
            urgent: false,
            context: `Seller ${tx.seller.username ?? tx.seller.firstName ?? tx.seller.email} hasn't accepted "${tx.listing.title}" within ${ACCEPT_DEADLINE_HOURS}h.`,
          },
        });
        void this.tracking.recordInternal(tx.id, 'ACCEPT_ESCALATED');
        // Admin notification — uses the broadcast-style admin channel
        // already wired in NotificationsService.
        await this.notifications.saleAcceptEscalatedAdmin({
          transactionId: tx.id,
          listingTitle: tx.listing.title,
          sellerName:
            tx.seller.username ??
            ([tx.seller.firstName, tx.seller.lastName]
              .filter(Boolean)
              .join(' ') ||
              tx.seller.email),
        });
        escalated++;
      } catch (err) {
        this.logger.warn(
          `accept escalation failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: stale.length, escalated };
  }

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
    if (tx.rejectedAt) {
      throw new BadRequestException(
        'This sale was rejected and refunded — cannot dispatch.',
      );
    }
    // TOK-7 Phase 2 — accept is now a HARD gate. The Phase 1 soft
    // warning is gone; sellers must tap Accept (one-tap from SMS link
    // OR the Accept button on the transaction page) before they can
    // mark dispatched. Any in-flight pre-Phase-2 transaction got its
    // acceptedAt = paidAt backfilled at Phase 1 deploy so this never
    // fires for legacy rows.
    if (!tx.acceptedAt) {
      throw new BadRequestException(
        'You need to accept the sale first. Tap "Accept this sale" — then you can mark it dispatched.',
      );
    }

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
    // Inbox: seller just dispatched → clear their "new sale" +
    // "dispatch reminder" rows for this tx. Buyer's new
    // "order_dispatched" row that fires inside sendDispatchedNotification
    // is action-required (must confirm delivery) and resolves later
    // via confirmDelivery.
    void this.notifications.resolveByEntity('transaction', transactionId);
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
        // Username only — the order-list UI shows @username per platform
        // policy, and this payload goes to the client, so we must NOT
        // include the counterparty's real name (POPIA). Internal flows
        // that need the legal name query it directly, not via this list.
        buyer: { select: { username: true } },
        seller: { select: { username: true } },
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
      // POPIA + platform policy: the COUNTERPARTY's identity is private
      // until a paid PRIVATE_ARRANGE reveal. Blank the other party's
      // real name, email and phone from the response — @username (a
      // separate public field) is the only identifier each side sees.
      // We never touch the viewer's OWN row. email is non-null in the
      // model so we clear it through an unknown cast on the response
      // object only (not persisted).
      if (tx.buyerId !== user.id) {
        tx.buyer.phone = null;
        tx.buyer.firstName = null;
        tx.buyer.lastName = null;
        (tx.buyer as unknown as { email: string | null }).email = null;
      }
      if (tx.sellerId !== user.id) {
        tx.seller.phone = null;
        tx.seller.firstName = null;
        tx.seller.lastName = null;
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
    // Inbox: buyer just confirmed delivery → clear their
    // "order_dispatched" notification on this transaction. The seller
    // gets a new "payment_released" row from sendReleasedNotification
    // which is dismissible (no further action).
    void this.notifications.resolveByEntity('transaction', transactionId, {
      userId: tx.buyerId,
    });
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
    result: PeachPaymentResult,
    listing: { id: string; sellerId: string },
    expectedBuyerTotal: number,
  ) {
    // ─── SECURITY: bind the gateway result to THIS transaction ────────
    // Without these two checks, a single genuine Peach success result
    // (resourcePath / webhook) could be replayed against ANY other
    // transaction id, or against an order whose amount differs from what
    // was actually paid. We require an exact match on both before any
    // money-state mutation. This is the primary fix for the "mark any
    // order paid for free" class of attack — it holds even on the
    // unauthenticated verify-result + webhook paths, because Peach binds
    // its own resourcePath to one checkout (one merchantTransactionId +
    // one amount), so an attacker cannot produce a success whose
    // merchantTransactionId equals the victim tx without paying it.
    if (result.merchantTransactionId !== txId) {
      this.logger.error(
        `markPaid REJECTED: gateway merchantTransactionId="${result.merchantTransactionId}" does not match transaction "${txId}" — possible replay/forgery`,
      );
      throw new BadRequestException('Payment does not match this transaction.');
    }
    if (result.amount !== expectedBuyerTotal) {
      this.logger.error(
        `markPaid REJECTED: gateway amount=${result.amount}c != expected ${expectedBuyerTotal}c for tx ${txId} — amount mismatch`,
      );
      throw new BadRequestException('Payment amount does not match the order total.');
    }

    const paidAt = new Date();
    // TOK-7: seller has 48h from payment to ACCEPT the transaction.
    // We compute + store the deadline here so the UI countdown chip
    // can render it directly without recomputing, and the
    // accept-escalation cron can do an indexed scan.
    const acceptDeadlineAt = new Date(
      paidAt.getTime() + ACCEPT_DEADLINE_HOURS * 60 * 60 * 1000,
    );

    // ─── ATOMIC idempotency guard ─────────────────────────────────────
    // updateMany with a paidAt=null predicate so only ONE concurrent
    // caller (result-page race vs webhook race vs double-click) can flip
    // the row to paid. count===0 means another path already claimed it —
    // a successful no-op, not an error.
    const claim = await this.prisma.transaction.updateMany({
      where: { id: txId, paidAt: null },
      data: {
        paymentStatus: 'HELD',
        peachPaymentId: result.paymentId,
        peachResultCode: result.resultCode,
        paidAt,
        acceptDeadlineAt,
      },
    });
    if (claim.count === 0) {
      this.logger.log(
        `markPaid: transaction ${txId} was already claimed by another path — skipping`,
      );
      return;
    }

    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: 'SOLD', soldAt: new Date() },
    });

    this.logger.log(`Transaction ${txId} paid — listing ${listing.id} marked SOLD`);

    // The item is now SOLD — reject every still-open offer on this
    // listing from OTHER buyers (TAKE_A_SHOT can have several ACCEPTED
    // offers at once). Stops a losing offerer from later trying to pay
    // for an item that's gone. Fire-and-forget; the atomic reserve above
    // is the hard backstop, this is the cleanup.
    void this.rejectSiblingOffersOnSale(txId, listing.id);

    // Append an INTERNAL milestone row so the buyer/seller timeline
    // starts with a "Payment received" marker BEFORE the seller marks
    // dispatch. Fire-and-forget — tracking is non-critical.
    void this.tracking.recordInternal(txId, 'PAYMENT_RECEIVED');

    // Inbox: buyer just paid → clear any "you won the auction — pay
    // now" or "offer accepted — pay" notifications they had on this
    // listing. We resolve by listingId (auction won was linked to
    // listing) and optimistically try the offer linkage too via a
    // separate lookup on the tx's offerId if present.
    void this.resolveBuyerPaymentNotifications(txId, listing.id);

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
  // After a sale completes, reject every still-open offer on the same
  // listing from OTHER buyers. TAKE_A_SHOT listings can carry several
  // ACCEPTED offers at once; once one buyer pays, the rest can never be
  // fulfilled, so flip them to REJECTED to stop their checkout attempts
  // (which would otherwise fail less gracefully at the reserve step).
  // We exclude the winning buyer's own offer by buyerId so we never
  // reject the offer that produced this sale.
  // ------------------------------------------------------------------
  private async rejectSiblingOffersOnSale(txId: string, listingId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: { buyerId: true },
      });
      if (!tx) return;
      const res = await this.prisma.offer.updateMany({
        where: {
          listingId,
          buyerId: { not: tx.buyerId },
          status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] },
        },
        data: { status: 'REJECTED' },
      });
      if (res.count > 0) {
        this.logger.log(
          `Rejected ${res.count} sibling offer(s) on sold listing ${listingId}`,
        );
        // Clear those buyers' "offer accepted — pay now" inbox rows.
        void this.notifications.resolveByEntity('listing', listingId);
      }
    } catch (err) {
      this.logger.warn(
        `rejectSiblingOffersOnSale failed for ${txId}: ${(err as Error).message}`,
      );
    }
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
      // Mint the TRANSACTION_ACCEPT token so the seller can tap the
      // SMS link and accept the sale in one tap (no sign-in). 48h TTL
      // matches the operator-confirmed accept window; if the seller
      // never taps, the cron escalates to admin (Phase 2).
      let acceptActionUrl: string | undefined;
      try {
        const expiresAt = new Date(
          Date.now() + ACCEPT_DEADLINE_HOURS * 60 * 60 * 1000,
        );
        const token = await this.tokens.mint({
          purpose: 'TRANSACTION_ACCEPT',
          targetType: 'transaction',
          targetId: txId,
          authorisedUserId: tx.sellerId,
          expiresAt,
        });
        const appUrl =
          process.env.FRONTEND_URL ?? 'https://gungalore.co.za';
        acceptActionUrl = `${appUrl}/a/${token}`;
      } catch (err) {
        this.logger.warn(
          `Failed to mint TRANSACTION_ACCEPT token for ${txId}: ${
            (err as Error).message
          } — falling back to dashboard link`,
        );
      }

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
        // Optional — when set, the seller-facing SMS + email use this
        // /a/<token> URL for the "Accept this sale" call-to-action.
        acceptActionUrl,
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

  // Clears the buyer-side auction_won notification on this listing
  // now that they've paid. Offer-linked rows (offer_accepted) are
  // dismissible by the buyer once they've paid since the Transaction
  // model has no offerId foreign key — auto-resolve isn't possible.
  private async resolveBuyerPaymentNotifications(txId: string, listingId: string) {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: { buyerId: true },
      });
      if (!tx) return;
      await this.notifications.resolveByEntity('listing', listingId, {
        userId: tx.buyerId,
      });
    } catch (err) {
      this.logger.warn(
        `resolveBuyerPaymentNotifications ${txId} failed: ${(err as Error).message}`,
      );
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
