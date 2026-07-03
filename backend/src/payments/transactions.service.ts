import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeeCalculator, SHIPPING_HANDLING_FEE_CENTS } from './fee.calculator';
import { StitchService, StitchPaymentResult } from './stitch.service';
import { FraudRiskService } from './fraud-risk.service';
import { WishlistAlertsService } from '../wishlist-alerts/wishlist-alerts.service';
import { estimateDeliveryDate } from '../shipping/delivery-estimate';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { resolvePurchaseQuantity, reversalListingData } from './inventory';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  computeOrderTotals,
  assertNoDuplicateListings,
  OrderLineBreakdown,
} from '../orders/order-math';
import { ListingStatus, Province, ShippingMethod } from '@prisma/client';
import { KycService } from '../kyc/kyc.service';
import { ShippingService } from '../shipping/shipping.service';
import { TrackingService } from '../shipping/tracking.service';
import { Inject, forwardRef } from '@nestjs/common';
import { ActionTokensService } from '../actions/action-tokens.service';
import {
  ReferenceNumberService,
  type OrderRefSource,
} from '../common/reference-number.service';

// Manual EFT mode (no live card gateway). When PAYMENT_MODE=manual the
// checkout issues bank-deposit instructions + an order reference instead
// of a Stitch payment link; the FNB statement reconciliation confirms it.
// Defaults to 'manual' since the gateway is dormant.
export const PAYMENT_MODE: 'manual' | 'paygate' =
  process.env.PAYMENT_MODE === 'paygate' ? 'paygate' : 'manual';
// How long a listing stays frozen awaiting the committed buyer's EFT.
// 24h (operator decision): long enough that the daily FNB statement
// reconciliation runs at least once while the item is still reserved for
// THIS buyer — so a genuine payment is caught + confirmed before the
// listing is ever released to other buyers. Fairer to the first buyer
// than a short window, and the statement stays the source of truth.
export const MANUAL_PAY_WINDOW_MS = 24 * 60 * 60 * 1000;
// GG's FNB receiving account, shown to the buyer at manual checkout.
export const GG_BANK_DETAILS = {
  accountName: 'Gun Galore (Pty) Ltd',
  bank: 'First National Bank (FNB)',
  accountNumber: '63210989191',
  branchCode: '250655',
  accountType: 'Gold Business Account',
};

// TOK-7 — accept→dispatch state machine deadlines.
// Spec (operator-confirmed 2026-05-27):
//   - 48h from payment for the seller to ACCEPT the transaction
//   - 5 days from acceptance for the seller to DISPATCH
//   - 48h no-accept: escalate to admin queue (no auto-refund)
//   - 5d no-dispatch: existing auto-refund + strike flow (unchanged)
export const ACCEPT_DEADLINE_HOURS = 48;
export const DISPATCH_DEADLINE_DAYS = 5;

// Gateway-agnostic payment-result shape that markPaid() binds on. (Was
// PeachPaymentResult — the gateway is now Stitch.) The verify-result and
// webhook paths each map their provider response into this.
interface GatewayPaymentResult {
  paymentId: string;
  resultCode: string;
  amount: number;
  currency: string;
  merchantTransactionId: string;
  isSuccess: boolean;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeCalculator,
    private readonly notifications: NotificationsService,
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
    private readonly referenceNumbers: ReferenceNumberService,
    private readonly fraudRisk: FraudRiskService,
    // CloudinaryModule is @Global — used by uploadPodProof (Phase 5 P5.3).
    private readonly cloudinary: CloudinaryService,
    // ZohoModule is @Global. P0.6 — commission invoicing fires at the
    // buyer-confirm release point (was firearm-dealer-verify only, so
    // ordinary sales never reached Books).
    private readonly zohoBooks: ZohoBooksService,
    // P5.2 — wishlist "your saved item sold" fan-out.
    private readonly wishlistAlerts: WishlistAlertsService,
  ) {}

  // ------------------------------------------------------------------
  // Create a transaction and a Peach checkout session
  // ------------------------------------------------------------------
  // Shared checkout CORE (Phase 8b). Validates buyer/listing/offer/shipping/
  // firearm-attestation/dealer, resolves price + quantity (Phase 8a), quotes
  // shipping, computes the fee breakdown, ATOMICALLY reserves the listing
  // (oversell-safe), creates the Transaction, and fires the seller-KYC
  // trigger — but performs NO payment. Both single-item create() and the
  // multi-item order checkout (OrdersService) call this; the CALLER owns the
  // payment step (one capture per order) and, for orders, the offer→CONVERTED
  // update. Returns every local the payment step needs.
  private async reserveAndCreateLine(
    buyerClerkId: string,
    dto: CreateTransactionDto,
    // P6.2 — when a cart line is part of a consolidated per-seller shipment,
    // the caller pre-computes the split (carrier line = the ONE combined
    // quote; sibling lines = 0) and passes it here, so this line's fee
    // breakdown is computed with the CONSOLIDATED shipping from the start
    // (no re-quote, no re-derive). Undefined = quote per-line as normal.
    shippingOverride?: { costCents: number; serviceCode: string | null },
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
    let offerRecord: { id: string; offerAmount: number; counterAmount: number | null; buyerId: string; status: string; listingId: string } | null = null;
    // P0.2 — auction-winner checkout takes a different validation +
    // reservation path (the listing is ALREADY reserved for the winner).
    let auctionWin = false;
    if (dto.offerId) {
      const rawOffer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
      if (!rawOffer) throw new NotFoundException('Offer not found');
      if (rawOffer.buyerId !== buyer.id) throw new ForbiddenException('Offer does not belong to you');
      if (rawOffer.status !== 'ACCEPTED') throw new BadRequestException('Offer is not accepted');
      // C1 — HARD BIND: the offer's listing MUST match the listing being
      // checked out. Without this an attacker with any accepted offer on
      // a cheap listing could submit checkout pointing at a DIFFERENT,
      // more expensive listing, pay the cheap-offer amount, and steal
      // the expensive item (it would be marked SOLD on the other seller).
      // This is the offer→listing binding the audit identified as
      // CRITICAL price-substitution / inventory theft.
      if (rawOffer.listingId !== dto.listingId) {
        this.logger.error(
          `Offer→listing binding REJECTED: offer ${rawOffer.id} is on listing ${rawOffer.listingId}, not ${dto.listingId} (buyer ${buyer.id}) — possible price-substitution attempt`,
        );
        throw new BadRequestException(
          'This offer is not on the listing you are trying to buy.',
        );
      }
      if (listing.listingType !== 'TAKE_A_SHOT') throw new BadRequestException('Offer checkout requires a TAKE_A_SHOT listing');
      offerRecord = rawOffer;
    } else if (listing.listingType === 'AUCTION') {
      // ---- Auction-winner checkout (P0.2) ----
      // finalizeAuction already flipped the listing ACTIVE→PAYMENT_PENDING
      // for the winner and stamped expiresAt as the 24h pay window, so the
      // ordinary ACTIVE-gate + reserve flip below would dead-end every won
      // auction. Winner-only, post-end, inside the window:
      if (listing.status !== ListingStatus.PAYMENT_PENDING || !listing.endedAt) {
        throw new BadRequestException(
          'This auction is not awaiting payment — it may still be running, or it has already been settled.',
        );
      }
      if (listing.currentBidderId !== buyer.id) {
        throw new ForbiddenException(
          'Only the winning bidder can pay for this auction.',
        );
      }
      if (listing.expiresAt && listing.expiresAt < new Date()) {
        throw new BadRequestException(
          'The 24-hour payment window for this auction has lapsed.',
        );
      }
      if (!listing.currentBid || listing.currentBid <= 0) {
        throw new BadRequestException('Winning bid amount is missing.');
      }
      auctionWin = true;
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
      listing.collectionOnly,
      listing.shippingMethods,
      dto.shippingMethod,
    );

    // M33 — 18+/competency attestation on firearm checkouts. Required
    // by the audit + SAPS regulatory framework. Refuse the transaction
    // server-side if the flag is not explicitly true on a firearm
    // listing — the frontend gate is convenience UX, this is the
    // authoritative check. Non-firearm checkouts ignore the flag.
    if (listing.isFirearm && dto.firearmAttestation18Plus !== true) {
      throw new BadRequestException(
        'You must confirm you are over 18 and (where applicable) hold the relevant SAPS competency before buying a firearm.',
      );
    }

    // P3 — collection papers acknowledgement (trailers / off-road caravans).
    // Mirror the firearm attestation: the flag must be explicitly true when
    // the listing requires papers. The frontend gate is UX; this is the
    // authoritative check. Persisted as collectionPapersAckAt below.
    if (listing.requiresPapers && dto.collectionPapersAccepted !== true) {
      throw new BadRequestException(
        'You must confirm you will collect this item in person and receive the registration / roadworthy papers from the seller at handover.',
      );
    }

    // If dealer transfer, verify the dealer exists and is active
    if (dto.shippingMethod === 'DEALER_TRANSFER' && dto.dealerId) {
      const dealer = await this.prisma.dealer.findUnique({ where: { id: dto.dealerId } });
      if (!dealer || !dealer.isActive) throw new NotFoundException('Dealer not found or inactive');
    }

    // The settled price: offers use counter (if accepted) or original offer;
    // auction winners pay the winning bid; else the listed price.
    const agreedPrice = offerRecord
      ? (offerRecord.counterAmount ?? offerRecord.offerAmount)
      : auctionWin
        ? (listing.currentBid ?? 0)
        : (listing.price ?? 0);
    if (!agreedPrice) throw new BadRequestException('Could not determine listing price');

    const isTopSeller = listing.seller.sellerTier === 'TOP_SELLER';

    // Quantity (Phase 8a). For every legacy/single-item listing
    // (trackInventory=false — the default) this resolves to exactly 1, so
    // the entire flow below is byte-for-byte unchanged. Only an
    // inventory-tracked BUY_NOW listing can resolve quantity > 1. Offers
    // are always single-item.
    const qres = resolvePurchaseQuantity({
      // Offers and auction wins are always single-item.
      requested: offerRecord || auctionWin ? 1 : (dto as { quantity?: number }).quantity,
      trackInventory: listing.trackInventory,
      quantityAvailable: listing.quantityAvailable,
      quantityReserved: listing.quantityReserved,
    });
    if ('error' in qres) throw new BadRequestException(qres.error);
    const quantity = qres.quantity;

    // Live shipping quote — re-fetched server-side so the buyer can't
    // tamper with the priceCents the frontend showed them. The same
    // quote endpoint the checkout UI hit pre-Pay runs again here. For
    // firearm transfers (DEALER_TRANSFER / PRIVATE_ARRANGE) there's no
    // courier rate; shippingCost = 0 and we skip the quote call.
    let shippingCostCents = 0;
    let shippingServiceCode: string | null = null;
    if (
      shippingOverride !== undefined &&
      (dto.shippingMethod === 'PUDO' || dto.shippingMethod === 'TCG')
    ) {
      // Consolidated-shipment split, pre-computed by createOrderCheckout from a
      // single combined server-side quote — not client-supplied, so no tamper
      // risk. Skip the per-line quote entirely.
      shippingCostCents = shippingOverride.costCents;
      shippingServiceCode = shippingOverride.serviceCode;
    } else if (
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

    // P6.4 — flat R15 handling margin charged ONCE per waybill GG creates.
    // A line produces its own waybill iff it's a PUDO/TCG courier line that is
    // NOT a zero-cost consolidated sibling (siblings ship free inside the
    // carrier's single parcel). Firearm DEALER_TRANSFER / PRIVATE_ARRANGE and
    // COLLECTION create no waybill → no handling. The margin is buyer-paid and
    // GG-retained (never remitted to the carrier).
    const isConsolidatedSibling =
      shippingOverride !== undefined && shippingOverride.costCents === 0;
    const producesWaybill =
      (dto.shippingMethod === 'PUDO' || dto.shippingMethod === 'TCG') &&
      !isConsolidatedSibling;
    const handlingFeeCents = producesWaybill ? SHIPPING_HANDLING_FEE_CENTS : 0;

    const {
      listingPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout,
    } = this.fees.breakdown(
      agreedPrice * quantity, // line subtotal — commission bands apply to the line
      listing.passFeeToBuyer,
      isTopSeller,
      shippingCostCents,
      PAYMENT_MODE, // manual = flat 1.5% EFT fee; paygate = card rate
      handlingFeeCents,
    );

    // Reserve the listing ATOMICALLY. Only ONE buyer can flip it from
    // ACTIVE → PAYMENT_PENDING. This is the double-sell guard: for
    // TAKE_A_SHOT listings multiple offers can be ACCEPTED at once, so
    // without a conditional reserve, N buyers could each create a
    // checkout and pay for the same single item (double-charge). The
    // BUY_NOW read-check above is racy on its own; this makes both paths
    // correct. count===0 means another buyer already reserved it or it
    // has sold.
    // Phase 8a: inventory-tracked listings reserve via an atomic counter
    // (quantityAvailable >= quantity → decrement) so multiple buyers can
    // hold different units concurrently. quantityAvailable changes ONLY
    // through these guarded ops, so the single-column guard is a correct
    // compare-and-set (no oversell). Legacy listings keep the exact
    // boolean ACTIVE→PAYMENT_PENDING flip.
    // P0.2 — auction claim: the listing is ALREADY PAYMENT_PENDING for this
    // winner, so the ACTIVE→PAYMENT_PENDING flip can't be the guard. Instead
    // we CAS the pay-window column: expiresAt (stamped by finalizeAuction) is
    // NULLED exactly once here. A second checkout attempt (double-click /
    // re-opened SMS link) matches 0 rows. Once a transaction exists, its own
    // manualPayByAt window + the freeze sweep own the lifecycle; the
    // unpaid-winner sweep (expiresAt < now, no claim) can no longer fire.
    const reserve = auctionWin
      ? await this.prisma.listing.updateMany({
          where: {
            id: listing.id,
            status: ListingStatus.PAYMENT_PENDING,
            expiresAt: { not: null },
          },
          data: { expiresAt: null },
        })
      : listing.trackInventory
      ? await this.prisma.listing.updateMany({
          where: {
            id: listing.id,
            status: ListingStatus.ACTIVE,
            quantityAvailable: { gte: quantity },
          },
          data: {
            quantityAvailable: { decrement: quantity },
            quantityReserved: { increment: quantity },
          },
        })
      : await this.prisma.listing.updateMany({
          where: { id: listing.id, status: ListingStatus.ACTIVE },
          data: { status: ListingStatus.PAYMENT_PENDING },
        });
    if (reserve.count === 0) {
      throw new BadRequestException(
        auctionWin
          ? 'You already have a payment in progress for this auction — check My Purchases to finish paying.'
          : 'This item is no longer available — another buyer is completing checkout, or it has already sold.',
      );
    }
    // Tracked listing fully reserved → hide from browse (PAYMENT_PENDING)
    // until paid (→ SOLD) or released (→ ACTIVE). Best-effort cosmetic flip;
    // the counter above is the real oversell guard.
    if (listing.trackInventory && listing.quantityAvailable - quantity <= 0) {
      await this.prisma.listing
        .updateMany({
          where: { id: listing.id, quantityAvailable: { lte: 0 } },
          data: { status: ListingStatus.PAYMENT_PENDING },
        })
        .catch(() => undefined);
    }

    // Create the transaction record first to get an ID. If this throws on
    // the auction path, restore the pay-window column we CAS-claimed above
    // so the winner can retry (and the unpaid-winner sweep still applies).
    const createTx = () => this.prisma.transaction.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        quantity,
        listingPrice,
        commissionZar,
        processingFee,
        shippingCost,
        shippingHandlingCents, // P6.4 — R15/waybill GG margin (0 for firearm/collection/sibling)
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
        // P3 — durable evidence the buyer acknowledged in-person collection +
        // papers handover for a trailer/caravan. Gate above enforces it.
        collectionPapersAckAt:
          listing.requiresPapers && dto.collectionPapersAccepted
            ? new Date()
            : null,
      },
    });
    const tx = await createTx().catch(async (err) => {
      if (auctionWin && listing.expiresAt) {
        await this.prisma.listing
          .updateMany({
            where: { id: listing.id, status: ListingStatus.PAYMENT_PENDING },
            data: { expiresAt: listing.expiresAt },
          })
          .catch(() => undefined);
      }
      throw err;
    });

    // M33 — durable evidence of the firearm-attestation flag. Logged
    // here (not persisted on Transaction yet) because adding the
    // `firearmAttestationAcceptedAt` column is held behind the
    // tsvector schema reconciliation on the launch checklist —
    // pushing schema today would risk dropping the runtime-added
    // FTS columns. The validation gate above is what enforces it; the
    // log line gives us a searchable record until persistence lands.
    if (listing.isFirearm) {
      this.logger.log(
        `FIREARM_ATTESTATION accepted=true tx=${tx.id} buyer=${buyer.id} listing=${listing.id}`,
      );
    }

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

    return {
      tx,
      listing,
      offerRecord,
      buyer,
      quantity,
      listingPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout,
    };
  }

  // Single-item checkout (the original create()). Reserves + creates ONE
  // transaction via the shared core, then runs the payment branch (manual
  // EFT today; gateway-neutral later). Behaviour is byte-identical to the
  // pre-8b create() — the only change is that the core is now a reusable
  // method that the multi-item order checkout also calls.
  async create(
    buyerClerkId: string,
    dto: CreateTransactionDto,
    frontendUrl: string,
  ) {
    const {
      tx,
      listing,
      offerRecord,
      buyer,
      quantity,
      listingPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout,
    } = await this.reserveAndCreateLine(buyerClerkId, dto);

    // ── Manual EFT branch (PAYMENT_MODE=manual) ────────────────────────
    // No card gateway: issue an order reference + GG bank-deposit
    // instructions instead of a Stitch link. The buyer EFTs using the
    // reference; the 10-min inContact scan detects it (provisional, stops
    // the 1-hour freeze) and the daily FNB statement reconciliation
    // confirms it (→ confirmManualPayment → SOLD → seller notified).
    if (PAYMENT_MODE === 'manual') {
      const orderRefSource: OrderRefSource = offerRecord
        ? 'TAKE_A_SHOT'
        : (listing.listingType as OrderRefSource);
      const orderReference =
        await this.referenceNumbers.allocateOrderReference(orderRefSource);
      const manualPayByAt = new Date(Date.now() + MANUAL_PAY_WINDOW_MS);
      const [updatedManual] = await this.prisma.$transaction([
        this.prisma.transaction.update({
          where: { id: tx.id },
          data: { orderReference, manualPayByAt },
        }),
        ...(offerRecord
          ? [
              this.prisma.offer.update({
                where: { id: offerRecord.id },
                data: { status: 'CONVERTED', transactionId: tx.id },
              }),
            ]
          : []),
      ]);
      return {
        transactionId: updatedManual.id,
        manual: true as const,
        orderReference,
        amountCents: buyerTotal,
        payByAt: manualPayByAt.toISOString(),
        bankDetails: GG_BANK_DETAILS,
        breakdown: {
          listingPrice,
          shippingCost,
          shippingHandlingCents, // P6.4 — R15/waybill margin (0 for firearm/collection)
          commissionZar,
          processingFee,
          buyerTotal,
          sellerPayout,
        },
      };
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
      // Tracked listing: give the units back (quantityAvailable += qty,
      // quantityReserved -= qty) + re-activate. Legacy: flip back to ACTIVE.
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: listing.trackInventory
          ? {
              status: ListingStatus.ACTIVE,
              quantityAvailable: { increment: quantity },
              quantityReserved: { decrement: quantity },
            }
          : { status: ListingStatus.ACTIVE },
      });
      await this.prisma.transaction.delete({ where: { id: tx.id } });
      this.logger.error(
        `Stitch createCheckout failed for tx ${tx.id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new BadRequestException(
        'Payment processing failed — please try again.',
      );
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

  // ==================================================================
  // Phase 8b — multi-item single-seller cart checkout (manual EFT)
  // ==================================================================
  // Reserves + creates ONE Transaction per line via the shared core, groups
  // them under a single Order with ONE EFT reference + total, and returns the
  // same manual-EFT payload shape the single-item flow uses. All-or-nothing:
  // any failed line unwinds every already-reserved line (restock + delete tx)
  // so a cart can never partially reserve or partially charge. Firearms /
  // auctions / take-a-shot are rejected (the shared core enforces BUY_NOW +
  // the firearm attestation, which a cart never supplies).
  async createOrderCheckout(
    buyerClerkId: string,
    dto: CreateOrderDto,
    _frontendUrl: string,
  ) {
    // Cart is EFT-only for now; the gateway-neutral seam lands with the new
    // paygate (Phase 8e). Refuse loudly rather than silently mis-charging.
    if (PAYMENT_MODE !== 'manual') {
      throw new BadRequestException(
        'Cart checkout is currently available via EFT only.',
      );
    }
    const lines = dto.lines ?? [];
    if (lines.length === 0) throw new BadRequestException('Your cart is empty');
    assertNoDuplicateListings(lines.map((l) => l.listingId));

    // P0.2 (review fix) — pre-validate line TYPES before ANY reservation.
    // The shared core no longer rejects all non-BUY_NOW (it gained the
    // auction-winner branch), and the in-loop belt-and-braces fires only
    // AFTER a line has reserved — for a won auction that reservation is the
    // expiresAt CAS claim, and unwinding it strands the auction. Cheap
    // read-only check up front keeps auctions out of carts entirely.
    // P6-A — firearms MAY now ride in the cart (they no longer courier-ship;
    // they branch to their own dealer / in-person route after payment and are
    // excluded from consolidation below), so isFirearm is NOT rejected here.
    // Only non-BUY_NOW types (auctions / swaps / take-a-shot) stay out.
    const lineListings = await this.prisma.listing.findMany({
      where: { id: { in: lines.map((l) => l.listingId) } },
      select: { id: true, listingType: true, isFirearm: true, sellerId: true },
    });
    if (lineListings.some((l) => l.listingType !== 'BUY_NOW')) {
      throw new BadRequestException(
        'Auctions, swaps and offer items must be bought individually, not in a cart.',
      );
    }
    const firearmByListing = new Map(
      lineListings.map((l) => [l.id, l.isFirearm]),
    );

    // P6.2 — per-seller shipping consolidation plan. Group the courier lines by
    // (seller, method, destination); for each group of 2+, get ONE combined
    // quote (combined weight + stacked box). If it succeeds, the FIRST line
    // becomes the "carrier" (charged the whole combined cost) and the rest ship
    // FREE with it (shipsWith the carrier) — the buyer pays one shipping fee,
    // GG books one parcel. Too-big-to-combine groups (e.g. exceed a Pudo
    // locker) get null and silently fall back to per-line quoting. Computed
    // BEFORE reservation so each line's fee breakdown uses the final shipping.
    const sellerByListing = new Map(
      lineListings.map((l) => [l.id, l.sellerId]),
    );
    const shipOverride = new Map<
      string,
      { costCents: number; serviceCode: string | null }
    >();
    // sibling listingId -> carrier listingId (resolved to tx ids after create)
    const carrierOfSibling = new Map<string, string>();
    {
      const groups = new Map<string, typeof lines>();
      for (const line of lines) {
        // P6-A — a firearm NEVER consolidates: it ships via dealer / in-person,
        // not a courier waybill, even alongside same-seller accessories. The
        // method check below already excludes DEALER_TRANSFER / PRIVATE_ARRANGE,
        // but skip explicitly on isFirearm too so a mis-routed firearm line
        // (e.g. a tampered PUDO method) can never be pulled into a parcel.
        if (firearmByListing.get(line.listingId)) continue;
        if (line.shippingMethod !== 'PUDO' && line.shippingMethod !== 'TCG')
          continue;
        const sellerId = sellerByListing.get(line.listingId);
        if (!sellerId) continue;
        const a = line.deliveryAddress;
        const destKey =
          line.shippingMethod === 'PUDO'
            ? `L:${line.pudoPickupLockerId ?? ''}`
            : `A:${a?.streetAddress ?? ''}|${a?.suburb ?? ''}|${a?.city ?? ''}|${a?.postalCode ?? ''}`;
        const key = `${sellerId}|${line.shippingMethod}|${destKey}`;
        const arr = groups.get(key) ?? [];
        arr.push(line);
        groups.set(key, arr);
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const method = group[0].shippingMethod as 'PUDO' | 'TCG';
        const a = group[0].deliveryAddress;
        const combined = await this.shipping.quoteCombined(
          group.map((g) => ({
            listingId: g.listingId,
            quantity: (g as { quantity?: number }).quantity ?? 1,
          })),
          method,
          method === 'PUDO'
            ? { toLockerId: group[0].pudoPickupLockerId }
            : {
                deliveryAddress: a
                  ? {
                      streetAddress: a.streetAddress,
                      suburb: a.suburb,
                      city: a.city,
                      postalCode: a.postalCode,
                      province: a.province as Province,
                      lat: (a as { lat?: number }).lat ?? 0,
                      lng: (a as { lng?: number }).lng ?? 0,
                    }
                  : undefined,
              },
        );
        if (!combined) continue; // too big / ineligible → per-line fallback
        const carrier = group[0];
        shipOverride.set(carrier.listingId, {
          costCents: combined.priceCents,
          serviceCode: combined.serviceCode,
        });
        for (let i = 1; i < group.length; i++) {
          shipOverride.set(group[i].listingId, {
            costCents: 0,
            serviceCode: null,
          });
          carrierOfSibling.set(group[i].listingId, carrier.listingId);
        }
      }
    }

    const created: Array<{
      tx: { id: string; buyerId: string };
      listing: { id: string; sellerId: string; trackInventory: boolean; price: number | null };
      quantity: number;
      breakdown: OrderLineBreakdown;
      commissionZar: number;
      sellerPayout: number;
    }> = [];

    try {
      for (const line of lines) {
        const lineDto = {
          listingId: line.listingId,
          shippingMethod: line.shippingMethod,
          pudoPickupLockerId: line.pudoPickupLockerId,
          deliveryAddress: line.deliveryAddress,
          quantity: line.quantity,
          // P6-A — firearm lines carry their own attestation + in-person
          // consent + optional dealer so the shared core's firearm gates
          // (validateShipping, the 18+ hard check, dealer lookup,
          // privateArrangeAcceptedAt) fire exactly as on a single-item buy.
          dealerId: line.dealerId,
          privateArrangeConsent: line.privateArrangeConsent,
          firearmAttestation18Plus: line.firearmAttestation18Plus,
        } as CreateTransactionDto;

        const core = await this.reserveAndCreateLine(
          buyerClerkId,
          lineDto,
          shipOverride.get(line.listingId),
        );
        const unitPrice = core.listing.price ?? 0;
        // Record the reservation BEFORE any further validation so the catch
        // below unwinds it too.
        created.push({
          tx: core.tx,
          listing: core.listing,
          quantity: core.quantity,
          commissionZar: core.commissionZar,
          sellerPayout: core.sellerPayout,
          breakdown: {
            unitPrice,
            quantity: core.quantity,
            listingPrice: core.listingPrice,
            shippingCost: core.shippingCost,
            shippingHandlingCents: core.shippingHandlingCents, // P6.4 — R15/waybill margin
            // BUYER-PAID processing fee only (0 when the seller absorbs it), so
            // the Order snapshot identity items + shipping + handling +
            // processingFee == buyerTotal always holds. Handling is subtracted
            // here too — it is NOT part of the processing fee. The
            // seller-absorbed fee lives in sellerPayout.
            processingFee:
              core.buyerTotal -
              core.listingPrice -
              core.shippingCost -
              core.shippingHandlingCents,
            buyerTotal: core.buyerTotal,
          },
        });

        // Belt-and-braces. NOTE: since P0.2 the core no longer rejects ALL
        // non-BUY_NOW — it added an AUCTION-winner branch — so the cart must
        // exclude auctions EXPLICITLY: a won auction consumed as a cart line
        // would CAS its pay-window claim, and any later line failing would
        // unwind it into the un-transactable ended-ACTIVE zombie state
        // (adversarial-review finding). Auctions pay via single checkout only.
        // P6-A — firearm BUY_NOW lines are now ALLOWED in the cart (they branch
        // to dealer / in-person and never consolidate), so isFirearm is no
        // longer part of this guard.
        if (core.listing.listingType !== 'BUY_NOW' || core.offerRecord) {
          throw new BadRequestException(
            'Auctions and offer items must be bought individually, not in a cart.',
          );
        }
      }

      // Phase 8d — a cart may span MULTIPLE sellers. One Order + one EFT from
      // the buyer fans out to N per-listing transactions; each seller is paid
      // independently on their own delivery confirmation (standard
      // marketplace split). The single-seller guard is intentionally gone.
      const sellerCount = new Set(created.map((c) => c.listing.sellerId)).size;
      const totals = computeOrderTotals(created.map((c) => c.breakdown));
      const orderReference =
        await this.referenceNumbers.allocateOrderReference('BUY_NOW');
      const manualPayByAt = new Date(Date.now() + MANUAL_PAY_WINDOW_MS);
      const buyerId = created[0].tx.buyerId;

      const order = await this.prisma.$transaction(async (txc) => {
        const o = await txc.order.create({
          data: {
            buyerId,
            status: 'AWAITING_PAYMENT',
            paymentMethod: 'MANUAL_EFT',
            orderReference,
            itemsSubtotal: totals.itemsSubtotal,
            shippingSubtotal: totals.shippingSubtotal,
            handlingSubtotal: totals.handlingSubtotal, // P6.4 — GG margin (sum of line handling)
            processingFee: totals.processingFee,
            buyerTotal: totals.buyerTotal,
            manualPayByAt,
            lineItems: {
              create: created.map((c) => ({
                transactionId: c.tx.id,
                listingId: c.listing.id,
                sellerId: c.listing.sellerId,
                quantity: c.quantity,
                unitPrice: c.breakdown.unitPrice,
                lineSubtotal: c.breakdown.listingPrice,
              })),
            },
          },
        });
        // Link every child transaction to the order (children carry NO
        // per-tx orderReference / manualPayByAt, so the per-tx freeze sweep
        // ignores them — the order-level sweep releases them together).
        await txc.transaction.updateMany({
          where: { id: { in: created.map((c) => c.tx.id) } },
          data: { orderId: o.id },
        });
        // P6.2 — link each consolidated sibling line to its carrier line's
        // transaction, so booking/tracking/delivery/release treat the group
        // as one shipment. Resolved from the listingId→txId map just built.
        if (carrierOfSibling.size > 0) {
          const txByListing = new Map(
            created.map((c) => [c.listing.id, c.tx.id]),
          );
          for (const [siblingListingId, carrierListingId] of carrierOfSibling) {
            const siblingTxId = txByListing.get(siblingListingId);
            const carrierTxId = txByListing.get(carrierListingId);
            if (siblingTxId && carrierTxId) {
              await txc.transaction.update({
                where: { id: siblingTxId },
                data: { shipsWithId: carrierTxId },
              });
            }
          }
        }
        return o;
      });

      this.logger.log(
        `Order ${order.id} (${orderReference}) created — ${created.length} lines across ${sellerCount} seller(s), total ${totals.buyerTotal}c`,
      );

      return {
        orderId: order.id,
        // The shared manual-EFT banking screen links on transactionId; the
        // order-checkout UI maps this to /orders/[id].
        transactionId: order.id,
        manual: true as const,
        orderReference,
        amountCents: totals.buyerTotal,
        payByAt: manualPayByAt.toISOString(),
        bankDetails: GG_BANK_DETAILS,
        itemCount: created.length,
        breakdown: {
          listingPrice: totals.itemsSubtotal,
          shippingCost: totals.shippingSubtotal,
          shippingHandlingCents: totals.handlingSubtotal, // P6.4 — R15/waybill GG margin
          commissionZar: created.reduce((s, c) => s + c.commissionZar, 0),
          processingFee: totals.processingFee,
          buyerTotal: totals.buyerTotal,
          sellerPayout: created.reduce((s, c) => s + c.sellerPayout, 0),
        },
      };
    } catch (err) {
      await this.unwindOrderLines(created);
      throw err;
    }
  }

  // Compensating rollback for createOrderCheckout: restore every reserved
  // listing (tracked: give units back + re-activate; legacy: ACTIVE) and
  // delete its transaction. ATOMIC — one $transaction so it can never leave a
  // half-compensated state (some listings freed, some txs orphaned). If the
  // whole compensation fails, the orphan-reclaim sweep (tasks.service) is the
  // backstop: it reclaims HELD txs with orderId/orderReference/peachCheckoutId/
  // manualPayByAt all null. Runs BEFORE any Order row exists, so no
  // OrderLineItem references these txs (the delete is FK-safe).
  private async unwindOrderLines(
    created: Array<{
      tx: { id: string };
      listing: { id: string; trackInventory: boolean };
      quantity: number;
    }>,
  ) {
    if (created.length === 0) return;
    try {
      await this.prisma.$transaction([
        ...created.map((c) =>
          this.prisma.listing.update({
            where: { id: c.listing.id },
            data: c.listing.trackInventory
              ? {
                  status: ListingStatus.ACTIVE,
                  quantityAvailable: { increment: c.quantity },
                  quantityReserved: { decrement: c.quantity },
                }
              : { status: ListingStatus.ACTIVE },
          }),
        ),
        ...created.map((c) =>
          this.prisma.transaction.delete({ where: { id: c.tx.id } }),
        ),
      ]);
    } catch (e) {
      this.logger.error(
        `unwindOrderLines: atomic compensation failed for ${created.length} lines (orphan-reclaim sweep will recover): ${(e as Error).message}`,
      );
    }
  }

  // Confirm a multi-item Order's EFT (called by the reconciler when the FNB
  // statement matches Order.orderReference). Race-safe against the order
  // freeze sweep via an atomic PRE-CLAIM (stamp manualDetectedAt so the sweep
  // can no longer select/cancel this order before any child goes SOLD), then
  // fans out the per-child markPaid (each re-binds its own amount + id, so the
  // security checks hold and the per-child buyer notice is suppressed), then
  // an atomic PAID-claim so the single consolidated buyer confirmation fires
  // exactly once. Idempotent + resilient to a partial run (re-running heals
  // because each child early-returns on its own paidAt; a partial failure
  // raises an admin alert and never leaves the order swept).
  async confirmManualOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        transactions: { select: { id: true, buyerTotal: true } },
        buyer: {
          select: { email: true, firstName: true, lastName: true, phone: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paidAt) {
      this.logger.log(`confirmManualOrder: ${orderId} already paid — skipping`);
      return;
    }
    // Defence-in-depth amount invariant: the order total MUST equal the sum of
    // its children (the reconciler matched the lump EFT to order.buyerTotal).
    const childSum = order.transactions.reduce((s, t) => s + t.buyerTotal, 0);
    if (childSum !== order.buyerTotal) {
      this.logger.error(
        `confirmManualOrder ${orderId}: child sum ${childSum} != order total ${order.buyerTotal} — refusing`,
      );
      throw new BadRequestException('Order total does not match its line items');
    }
    // ATOMIC PRE-CLAIM — stamp manualDetectedAt. The order freeze sweep only
    // selects orders with manualDetectedAt=null, so once this commits the
    // sweep can never cancel/restock this order while we pay its children.
    // count===0 ⇒ already paid or cancelled (e.g. swept first) ⇒ bail.
    const preclaim = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        paidAt: null,
        manualCancelledAt: null,
        status: 'AWAITING_PAYMENT',
      },
      data: { manualDetectedAt: new Date() },
    });
    if (preclaim.count === 0) {
      this.logger.warn(
        `confirmManualOrder ${orderId}: not claimable (paid/cancelled) — skipping`,
      );
      return;
    }
    try {
      for (const child of order.transactions) {
        // Per-child: derives its own EFT-${childId} paymentId, binds
        // amount = child.buyerTotal + merchantTransactionId = childId, and (via
        // tx.orderId) suppresses the per-child buyer "order confirmed" notice.
        await this.confirmManualPayment(child.id);
      }
    } catch (err) {
      // Partial fan-out: some children are paid, some not. The order keeps
      // manualDetectedAt set (so the sweep won't touch it) and stays
      // AWAITING_PAYMENT; a re-uploaded statement re-runs and heals (paid
      // children early-return). Surface it so an operator can investigate.
      this.logger.error(
        `confirmManualOrder ${orderId}: partial fan-out — ${(err as Error).message}`,
      );
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'ORDER_PARTIAL_CONFIRM',
            referenceId: orderId,
            urgent: true,
            context: `Order ${order.orderReference ?? orderId} EFT confirm failed mid-fan-out: ${(err as Error).message}. Some line items may be paid and some not — re-upload the statement to heal, or investigate.`,
          },
        })
        .catch(() => undefined);
      throw err;
    }
    // ATOMIC PAID-CLAIM — only the winner sends the ONE buyer confirmation.
    const paidClaim = await this.prisma.order.updateMany({
      where: { id: orderId, paidAt: null },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (paidClaim.count !== 1) return; // a concurrent pass already rolled up
    try {
      await this.notifications.orderConfirmedBuyerMulti({
        buyerEmail: order.buyer.email,
        buyerName:
          [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(' ') ||
          'there',
        buyerPhone: order.buyer.phone,
        orderId,
        orderReference: order.orderReference ?? orderId.slice(-8).toUpperCase(),
        itemCount: order.transactions.length,
        buyerTotal: order.buyerTotal,
      });
    } catch (e) {
      this.logger.error(
        `confirmManualOrder: buyer confirmation failed for ${orderId}: ${(e as Error).message}`,
      );
    }
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
        const result: GatewayPaymentResult = {
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

    // Chargeback / dispute / reversal events take a different path: never
    // auto-refund (the chargeback IS the reversal) — just hold the payout
    // and raise an admin alert for manual handling (Phase 4 P4.3).
    if (this.isChargebackEvent(evt.type)) {
      await this.handleChargebackEvent(evt);
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
  // Chargeback / dispute / reversal webhook (Phase 4 P4.3)
  // ------------------------------------------------------------------
  // The exact Stitch event name isn't pinned in the OpenAPI, so we match
  // defensively on the type string. A chargeback means the buyer's bank is
  // clawing the money back through the card/EFT scheme — it is itself the
  // reversal, so we MUST NOT also refund (that double-pays the buyer). We
  // hold the payout (→ DISPUTED) and raise an urgent admin alert for a
  // human to investigate + contest or concede.
  private isChargebackEvent(type?: string): boolean {
    if (!type) return false;
    return /charge.?back|dispute|reversal|reverse/i.test(type);
  }

  private async handleChargebackEvent(evt: {
    paymentId?: string;
    merchantReference?: string;
    type?: string;
  }) {
    const tx = await this.prisma.transaction.findFirst({
      where: evt.paymentId
        ? { peachCheckoutId: evt.paymentId }
        : { id: evt.merchantReference },
    });
    if (!tx) {
      this.logger.warn(
        `Stitch chargeback: no transaction for ${evt.paymentId ?? evt.merchantReference} (type=${evt.type})`,
      );
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'STITCH_CHARGEBACK_UNMATCHED',
            referenceId: evt.paymentId ?? evt.merchantReference ?? 'unknown',
            urgent: true,
            context: `Chargeback/dispute webhook (${evt.type}) could not be matched to a transaction. payment=${evt.paymentId ?? '—'} ref=${evt.merchantReference ?? '—'}.`,
          },
        })
        .catch(() => undefined);
      return;
    }

    // Idempotent — a retried webhook on an already-DISPUTED tx is a no-op.
    if (tx.paymentStatus === 'DISPUTED') {
      this.logger.log(`Stitch chargeback: ${tx.id} already DISPUTED — skipping`);
      return;
    }

    // Already refunded — the buyer was made whole through our own refund;
    // a chargeback on top would double-pay them. Flag so the operator can
    // contest the chargeback with the bank ("already refunded").
    if (tx.paymentStatus === 'REFUNDED') {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'STITCH_CHARGEBACK_AFTER_REFUND',
            referenceId: tx.id,
            urgent: true,
            context: `Chargeback (${evt.type}) on ${tx.id}, but the order was already REFUNDED. Likely a double-claim — contest with the bank. Do NOT refund again.`,
          },
        })
        .catch(() => undefined);
      void this.tracking.recordInternal(tx.id, 'STITCH_CHARGEBACK_RECEIVED', {
        message: `Chargeback received after refund (${evt.type}). Flagged for the bank.`,
      });
      return;
    }

    // Payout already released to the seller — we can't auto-reverse their
    // funds. This is the dangerous case: raise an URGENT alert so the
    // operator can recover from the seller / decide. Status stays RELEASED.
    if (tx.paymentStatus === 'RELEASED') {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'STITCH_CHARGEBACK_AFTER_PAYOUT',
            referenceId: tx.id,
            urgent: true,
            context: `Chargeback (${evt.type}) on ${tx.id} AFTER payout was RELEASED to the seller (${tx.buyerTotal}c). Funds already left to the seller — cannot auto-reverse. Manual recovery required.`,
          },
        })
        .catch(() => undefined);
      void this.tracking.recordInternal(tx.id, 'STITCH_CHARGEBACK_RECEIVED', {
        message: `Chargeback received after payout (${evt.type}). Manual recovery required.`,
      });
      return;
    }

    // Funds still held (HELD or PENDING_ADMIN_VERIFICATION) — flip to
    // DISPUTED so confirm-delivery / payout are blocked until an admin
    // resolves it. Atomic guard prevents racing a confirm-delivery release.
    const claim = await this.prisma.transaction.updateMany({
      where: {
        id: tx.id,
        paymentStatus: { in: ['HELD', 'PENDING_ADMIN_VERIFICATION'] },
      },
      data: { paymentStatus: 'DISPUTED' },
    });
    if (claim.count === 0) {
      // Status changed out from under us (e.g. released between read and
      // write). Don't recurse — just alert with the latest status so an
      // admin handles it manually.
      const fresh = await this.prisma.transaction.findUnique({
        where: { id: tx.id },
        select: { paymentStatus: true },
      });
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'STITCH_CHARGEBACK_RACE',
            referenceId: tx.id,
            urgent: true,
            context: `Chargeback (${evt.type}) on ${tx.id} arrived as the order changed state (now ${fresh?.paymentStatus ?? 'unknown'}). Could not auto-flip to DISPUTED — handle manually.`,
          },
        })
        .catch(() => undefined);
      this.logger.warn(
        `Stitch chargeback: ${tx.id} state changed during handling (now ${fresh?.paymentStatus}) — alerted`,
      );
      return;
    }

    await this.prisma.adminAlert
      .create({
        data: {
          type: 'STITCH_CHARGEBACK_INITIATED',
          referenceId: tx.id,
          urgent: true,
          context: `Chargeback/dispute (${evt.type}) on ${tx.id}. Funds were held → moved to DISPUTED, payout blocked. Investigate + resolve (release to seller or concede the chargeback). Do NOT issue a separate refund.`,
        },
      })
      .catch(() => undefined);
    void this.tracking.recordInternal(tx.id, 'STITCH_CHARGEBACK_RECEIVED', {
      message: `Chargeback received (${evt.type}). Order moved to DISPUTED; payout blocked.`,
    });
    this.logger.warn(`Stitch chargeback: ${tx.id} → DISPUTED (${evt.type})`);
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

    // P6.2 — a consolidated shipment ships as ONE parcel, so accepting ANY
    // line accepts the WHOLE group (carrier + its siblings) and books the ONE
    // shipment on the carrier. carrierId = this line's carrier, or itself when
    // it's a standalone line (a "group of one"). Stamp every still-live member
    // that isn't already accepted/rejected.
    const carrierId = tx.shipsWithId ?? transactionId;
    await this.prisma.transaction.updateMany({
      where: {
        OR: [{ id: carrierId }, { shipsWithId: carrierId }],
        acceptedAt: null,
        rejectedAt: null,
        paymentStatus: 'HELD',
      },
      data: { acceptedAt, dispatchDeadlineAt },
    });
    const updated =
      (await this.prisma.transaction.findUnique({
        where: { id: transactionId },
      })) ?? tx;

    // P5.2: book the real carrier shipment now that the seller has
    // committed — on the CARRIER line, which combines the whole group's
    // parcel. Fire-and-forget + fully self-contained (idempotent, courier-only,
    // fail-safe) — it must never make accept fail. On success it SMSes/emails
    // the seller the waybill + Pudo PIN + label link; on failure the seller
    // keeps the manual dispatch fallback.
    void this.shipping.bookForTransaction(carrierId);

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

  // P6.2 — is this transaction part of a LIVE consolidated shipment group?
  // True if it's a sibling (shipsWithId set) OR a carrier that still has live
  // (HELD) siblings shipping with it. A standalone line is never in a group.
  private async isConsolidatedGroupMember(
    transactionId: string,
    shipsWithId: string | null,
  ): Promise<boolean> {
    if (shipsWithId) return true;
    const liveSiblings = await this.prisma.transaction.count({
      where: { shipsWithId: transactionId, paymentStatus: 'HELD' },
    });
    return liveSiblings > 0;
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
            // FLOW-F2 — the refund is paid by EFT from the FNB batch; the
            // notification must say "add your bank details" when we can't.
            bankAccountHolder: true,
            bankAccountNumber: true,
            bankBranchCode: true,
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
    // FLOW-F1 — reject is only legal while the money is still HELD. Without
    // this, a PRIVATE_ARRANGE seller (funds released IMMEDIATELY at payment,
    // by explicit buyer consent) could tap the 48h accept/reject SMS token
    // AFTER being paid and flip a RELEASED transaction to REFUNDED — moving
    // the money twice and stranding the buyer's "refund" in the payout batch.
    // Mirrors the identical guard on cancelByBuyer.
    if (tx.paymentStatus !== 'HELD') {
      throw new BadRequestException(
        'This sale can no longer be rejected — payment has already been settled. Contact support if something is wrong.',
      );
    }
    // P6.2 — a consolidated shipment (2+ items in one parcel) must be handled
    // as a whole; single-line reject would orphan the other items that ship
    // with it. Fail closed to admin in v1 (they can refund each line from the
    // dossier) rather than risk a partial-parcel money/logistics bug.
    if (await this.isConsolidatedGroupMember(transactionId, tx.shipsWithId)) {
      throw new BadRequestException(
        'This item ships as one parcel with other items in the same order. To decline it, please contact support so the whole parcel is handled together.',
      );
    }

    // Fire the Stitch refund first — only stamp rejectedAt if it
    // succeeded, so an admin can retry on failure rather than the buyer
    // being stuck without a refund AND the listing reactivated.
    // peachPaymentId holds the Stitch payment id (column reused during
    // the Peach→Stitch transition).
    //
    // PAY-8 — if the tx has NO stored payment id we MUST NOT silently
    // flip to REFUNDED (the buyer was charged; no payment was reversed).
    // This previously diverged from the safer admin path. Treat it as a
    // hard failure that raises an admin alert for manual reconciliation.
    if (!tx.peachPaymentId) {
      this.logger.error(
        `Reject failed for ${transactionId}: paid tx has NO payment id — cannot refund; raising admin alert`,
      );
      await this.prisma.adminAlert.create({
        data: {
          type: 'SALE_REJECT_NO_PAYMENT_ID',
          referenceId: transactionId,
          urgent: true,
          context: `Seller tried to reject sale ${transactionId}; the transaction is marked paid but has no stored gateway payment id. Manual refund + manual status flip required.`,
        },
      });
      throw new BadRequestException(
        'Refund could not be issued automatically — support has been alerted and will resolve manually within 24h.',
      );
    }
    const refundRes = await this.stitch.refundPayment(
      tx.peachPaymentId,
      tx.buyerTotal,
    );

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

    // Atomic state change — only after refund succeeded. Phase 8a:
    // restock a tracked listing (legacy → plain ACTIVE reactivation).
    const rejLi = await this.prisma.listing.findUnique({
      where: { id: tx.listingId },
      select: { trackInventory: true, listingType: true },
    });
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
        // Ended auctions land EXPIRED, never back to ACTIVE (zombie fix).
        data: reversalListingData(
          rejLi?.trackInventory ?? false,
          tx.quantity ?? 1,
          rejLi?.listingType,
        ),
      }),
    ]);

    // P5.2: if the seller had already accepted (booking fires on accept),
    // cancel any live carrier shipment so a rejected sale doesn't leave a
    // billed waybill. No-op when nothing was booked.
    void this.shipping.cancelForTransaction(transactionId);

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
      // FLOW-F2 — rail-aware copy: EFT refund via the FNB batch, and flag
      // when we can't pay it until the buyer adds bank details.
      manualEft: PAYMENT_MODE === 'manual',
      needsBankDetails:
        PAYMENT_MODE === 'manual' &&
        !(
          tx.buyer.bankAccountHolder &&
          tx.buyer.bankAccountNumber &&
          tx.buyer.bankBranchCode
        ),
    });

    this.logger.log(
      `Transaction ${transactionId} REJECTED by seller ${seller.id} (reason: ${trimmedReason.slice(0, 80)})`,
    );
    return this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
  }

  // ------------------------------------------------------------------
  // Buyer-initiated cancellation (Phase 4 P4.2)
  // ------------------------------------------------------------------
  // A buyer may cancel + full-refund a paid order that hasn't shipped yet,
  // mirroring the seller-reject mechanics. Self-service is limited to
  // courier orders (PUDO/TCG): PRIVATE_ARRANGE pays out immediately (no
  // funds to return), and firearm DEALER_TRANSFER must go through the
  // dispute/admin path while verification is in flight. Unlike a seller
  // reject, cancelling carries NO seller strike — the buyer changing their
  // mind isn't the seller's fault.
  async cancelByBuyer(
    transactionId: string,
    buyerClerkId: string,
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
            id: true,
            email: true,
            firstName: true,
            phone: true,
            // FLOW-F2 — rail-aware refund copy needs the bank state.
            bankAccountHolder: true,
            bankAccountNumber: true,
            bankBranchCode: true,
          },
        },
        seller: {
          select: { email: true, firstName: true, phone: true },
        },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const buyer = await this.prisma.user.findUnique({
      where: { clerkId: buyerClerkId },
      select: { id: true },
    });
    if (!buyer || tx.buyerId !== buyer.id) {
      throw new ForbiddenException('Not authorised');
    }

    if (!tx.paidAt) {
      throw new BadRequestException('Payment not confirmed yet — nothing to cancel.');
    }
    if (tx.cancelledByBuyerAt) {
      // Idempotent — already cancelled is a successful no-op.
      return tx;
    }
    if (tx.rejectedAt) {
      throw new BadRequestException('This order was already cancelled by the seller.');
    }
    if (tx.dispatchedAt) {
      throw new BadRequestException('Already dispatched — it can no longer be cancelled. If there is a problem, raise a dispute.');
    }
    if (tx.paymentStatus !== 'HELD') {
      throw new BadRequestException(`Order is no longer cancellable (status: ${tx.paymentStatus}).`);
    }
    // P6.2 — a consolidated shipment must be cancelled as a whole parcel;
    // cancelling one line would orphan the others. Fail closed to admin in v1.
    if (await this.isConsolidatedGroupMember(transactionId, tx.shipsWithId)) {
      throw new BadRequestException(
        'This item ships as one parcel with other items in your order. To change or cancel it, please contact support so the whole parcel is handled together.',
      );
    }
    if (!['PUDO', 'TCG'].includes(tx.shippingMethod ?? '')) {
      throw new BadRequestException(
        'This order type cannot be self-cancelled. Please contact support or raise a dispute.',
      );
    }
    // PAY-8 — a paid order MUST have a stored gateway payment id to refund.
    if (!tx.peachPaymentId) {
      await this.prisma.adminAlert.create({
        data: {
          type: 'BUYER_CANCEL_NO_PAYMENT_ID',
          referenceId: transactionId,
          urgent: true,
          context: `Buyer tried to cancel ${transactionId}; tx is paid but has no stored gateway payment id. Manual refund + status flip required.`,
        },
      });
      throw new BadRequestException(
        'Refund could not be issued automatically — support has been alerted and will resolve manually within 24h.',
      );
    }

    // Atomic claim BEFORE the gateway call — the guards make the flip the
    // concurrency lock against a simultaneous seller dispatch/reject. On
    // gateway failure we roll the claim back.
    const claim = await this.prisma.transaction.updateMany({
      where: {
        id: transactionId,
        paymentStatus: 'HELD',
        dispatchedAt: null,
        rejectedAt: null,
        cancelledByBuyerAt: null,
        shippingMethod: { in: ['PUDO', 'TCG'] },
      },
      data: {
        paymentStatus: 'REFUNDED',
        cancelledByBuyerAt: new Date(),
        cancelledReason: trimmedReason,
        releasedAt: null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Order could not be cancelled — its state just changed (it may have been dispatched). Reload and try again.',
      );
    }

    const refundRes = await this.stitch.refundPayment(
      tx.peachPaymentId,
      tx.buyerTotal,
    );
    if (!refundRes.success) {
      // Roll the reservation back so the row returns to its prior state.
      await this.prisma.transaction
        .update({
          where: { id: transactionId },
          data: {
            paymentStatus: 'HELD',
            cancelledByBuyerAt: null,
            cancelledReason: null,
          },
        })
        .catch(() => undefined);
      await this.prisma.adminAlert.create({
        data: {
          type: 'BUYER_CANCEL_REFUND_FAILED',
          referenceId: transactionId,
          urgent: true,
          context: `Buyer cancel of ${transactionId}: Stitch refund failed (${refundRes.resultCode}). Buyer still owed ${tx.buyerTotal} cents.`,
        },
      });
      throw new BadRequestException(
        'Refund failed — support has been alerted and will resolve manually within 24h.',
      );
    }

    // Refund succeeded — reactivate the listing so it can sell again.
    // Phase 8a: restock a tracked listing (legacy → plain reactivation).
    const canLi = await this.prisma.listing.findUnique({
      where: { id: tx.listingId },
      select: { trackInventory: true, listingType: true },
    });
    await this.prisma.listing
      .update({
        where: { id: tx.listingId },
        // Ended auctions land EXPIRED, never back to ACTIVE (zombie fix).
        data: reversalListingData(
          canLi?.trackInventory ?? false,
          tx.quantity ?? 1,
          canLi?.listingType,
        ),
      })
      .catch(() => undefined);

    // P5.2: cancel any platform-booked carrier shipment (booking fires on
    // seller-accept, which can precede an undispatched buyer cancellation) so
    // the refunded order doesn't leave a live, billed waybill.
    void this.shipping.cancelForTransaction(transactionId);

    void this.tracking.recordInternal(transactionId, 'BUYER_CANCELLED', {
      message: `Buyer cancelled: ${trimmedReason}`,
    });
    void this.notifications.resolveByEntity('transaction', transactionId);
    void this.notifications.orderCancelledByBuyer({
      listingTitle: tx.listing.title,
      transactionId: tx.id,
      buyerTotal: tx.buyerTotal,
      reason: trimmedReason,
      buyer: {
        email: tx.buyer.email,
        firstName: tx.buyer.firstName,
        phone: tx.buyer.phone,
      },
      seller: {
        email: tx.seller.email,
        firstName: tx.seller.firstName,
        phone: tx.seller.phone,
      },
      // FLOW-F2 — rail-aware copy: EFT refund via the FNB batch, and flag
      // when we can't pay it until the buyer adds bank details.
      manualEft: PAYMENT_MODE === 'manual',
      needsBankDetails:
        PAYMENT_MODE === 'manual' &&
        !(
          tx.buyer.bankAccountHolder &&
          tx.buyer.bankAccountNumber &&
          tx.buyer.bankBranchCode
        ),
    });

    this.logger.log(
      `Transaction ${transactionId} CANCELLED by buyer ${buyer.id} (reason: ${trimmedReason.slice(0, 80)})`,
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

  // P5.2: stream the platform-booked shipment's waybill/label PDF to the
  // seller (key-safe proxy — carrier auth happens server-side). Seller-only,
  // and only once a shipment has actually been booked.
  async getWaybillPdf(
    transactionId: string,
    sellerClerkId: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        shippingMethod: true,
        carrierShipmentId: true,
        trackingReference: true,
        seller: { select: { clerkId: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.seller.clerkId !== sellerClerkId) {
      throw new ForbiddenException('Not authorised');
    }
    if (
      !tx.carrierShipmentId ||
      (tx.shippingMethod !== 'PUDO' && tx.shippingMethod !== 'TCG')
    ) {
      throw new BadRequestException('No waybill is available for this order yet.');
    }
    const pdf = await this.shipping.getWaybillPdf(
      tx.shippingMethod,
      tx.carrierShipmentId,
    );
    return {
      pdf,
      filename: `waybill-${tx.trackingReference ?? transactionId}.pdf`,
    };
  }

  // P5.2 passthrough so callers outside ShippingModule (e.g. AdminService's
  // refundTransaction) can cancel a booked carrier shipment on sale reversal.
  async cancelBookedShipment(transactionId: string): Promise<void> {
    await this.shipping.cancelForTransaction(transactionId);
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

    // Best-effort estimated delivery window (Phase 5 P5.1). Computed once
    // at dispatch from the courier's transit days; null for non-courier
    // methods. Always shown to the buyer as "estimated", never guaranteed.
    const dispatchedAt = new Date();
    const estimatedDeliveryAt = estimateDeliveryDate(
      tx.shippingMethod,
      dispatchedAt,
    );

    const updated = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        dispatchedAt,
        estimatedDeliveryAt,
        shippingStatus: 'COLLECTED',
        pudoDropoffLockerId: data.pudoDropoffLockerId,
        trackingReference: data.trackingReference,
      },
    });
    // P6.2 — a consolidated parcel dispatches as one. Mirror the dispatch onto
    // the group's other live lines so the auto-refund cron doesn't strand them
    // as "accepted but never dispatched" while the shared parcel is on its way.
    const carrierId = tx.shipsWithId ?? transactionId;
    await this.prisma.transaction.updateMany({
      where: {
        OR: [{ id: carrierId }, { shipsWithId: carrierId }],
        id: { not: transactionId },
        dispatchedAt: null,
        paymentStatus: 'HELD',
      },
      data: { dispatchedAt, estimatedDeliveryAt, shippingStatus: 'COLLECTED' },
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
  // Proof-of-delivery photo upload (Phase 5 P5.3)
  // ------------------------------------------------------------------
  // Either party may attach ONE delivery photo as dispute evidence. This
  // does NOT release or gate payout — payout stays on the buyer's
  // confirmDelivery attestation. Owner-checked + dispatch-gated.
  async uploadPodProof(
    transactionId: string,
    clerkId: string,
    file?: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new BadRequestException('No photo uploaded');
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, buyerId: true, sellerId: true, dispatchedAt: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user || (tx.buyerId !== user.id && tx.sellerId !== user.id)) {
      throw new ForbiddenException('Not authorised');
    }
    if (!tx.dispatchedAt) {
      throw new BadRequestException(
        'Proof of delivery can only be added after the order has been dispatched.',
      );
    }
    const { url } = await this.cloudinary.uploadImage(
      file.buffer,
      `transactions/pod/${transactionId}`,
    );
    return this.prisma.transaction.update({
      where: { id: transactionId },
      data: { podProofUrl: url },
      select: { id: true, podProofUrl: true },
    });
  }

  // ------------------------------------------------------------------
  // Fetch transactions for a user (buyer or seller view)
  // ------------------------------------------------------------------
  async findForUser(clerkId: string, role: 'buyer' | 'seller') {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    // refundOfId: null — synthetic refund-slice children are settlement
    // plumbing (FNB batch rows), not orders; showing them would add a
    // phantom "purchase"/"sale" per refund slice (review finding).
    const where =
      role === 'buyer'
        ? { buyerId: user.id, refundOfId: null }
        : { sellerId: user.id, refundOfId: null };

    const rows = await this.prisma.transaction.findMany({
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

    // The Pudo drop-off PIN is the SELLER's hand-over credential (P5.2) —
    // never include it in a BUYER's order list. (findMany returns the full
    // row, so strip it on the buyer view; the seller view keeps it.)
    if (role === 'buyer') {
      for (const r of rows) {
        (r as unknown as { carrierDropoffPin: string | null }).carrierDropoffPin = null;
      }
    }
    return rows;
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
        // P6.2 — when this line is a consolidated SIBLING (shipsWithId set), the
        // carrier ("main item") line owns the combined shipping fee, the booked
        // waybill/PIN and the tracking. Surface just the carrier's id +
        // trackingReference + status so the order page can point the buyer/seller
        // at the main item instead of offering this line its own dispatch /
        // tracking surfaces. carrierDropoffPin is deliberately NOT selected — it
        // stays seller-only on the carrier's own page. Null on a normal line and
        // on the carrier itself (shipsWithId null → relation is null).
        shipsWith: {
          select: {
            id: true,
            trackingReference: true,
            shippingStatus: true,
          },
        },
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
    // P3 — collection orders reveal contact once paid (HELD or RELEASED) so
    // the buyer + seller can coordinate the in-person pickup. Payment is
    // still HELD until the buyer confirms collection, so this is a
    // coordination reveal, not the PRIVATE_ARRANGE payment-protection waiver.
    const isPaidCollection =
      tx.shippingMethod === 'COLLECTION' &&
      // paymentStatus defaults to HELD at row creation, so HELD alone is NOT
      // proof of payment — an unpaid, freshly-reserved order is already HELD.
      // Require paidAt so contact details never reveal before real payment.
      !!tx.paidAt &&
      (tx.paymentStatus === 'HELD' || tx.paymentStatus === 'RELEASED');
    if (!isPaidPrivateArrange && !isPaidCollection) {
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

    // The Pudo drop-off PIN is the SELLER's hand-over credential (P5.2) —
    // never expose it to the buyer. The buyer gets their own collection PIN
    // from Pudo directly. trackingReference stays visible to both (the buyer
    // tracks with it). Applies regardless of shipping method.
    if (tx.sellerId !== user.id) {
      (tx as unknown as { carrierDropoffPin: string | null }).carrierDropoffPin =
        null;
    }

    // FLOW-F3 — re-viewable EFT instructions. The GG banking details used to
    // exist ONLY in the one-shot checkout response; a buyer who navigated away
    // could never see them (or the reference/amount) again, dead-ending an
    // unpaid order. While THIS BUYER's single-item manual order is still
    // awaiting payment (has a reference + open window, unpaid, not cancelled,
    // not an order child — those pay at the ORDER level), attach the bank
    // details so the page can re-render the full payment instructions.
    const awaitingEft =
      tx.buyerId === user.id &&
      !tx.paidAt &&
      !tx.manualCancelledAt &&
      !tx.orderId &&
      !!tx.orderReference &&
      !!tx.manualPayByAt;
    return {
      ...tx,
      bankDetails: awaitingEft ? GG_BANK_DETAILS : null,
    };
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
    // SWOP — a swap leg is a zero-money fulfilment record; it settles via the
    // Swap parent's rollup (shipping → both-delivered → releaseSwap), NOT the
    // per-leg confirm-delivery path (which would set RELEASED out-of-band,
    // double-count totalSales, and fire a phantom payout notice).
    if (tx.swapId) {
      throw new BadRequestException(
        'This is a swap — it is completed through the swap, not per-item confirm-delivery.',
      );
    }
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
    // Atomic guarded release: include paymentStatus='HELD' +
    // confirmedDeliveryAt=null in the WHERE so a concurrent admin
    // dispute (HELD→DISPUTED) or a double-click can't slip between the
    // read above and this write and release funds on a disputed order.
    // count===0 → the row moved out of HELD since we read it; abort and
    // roll the whole interactive transaction back (seller increment too).
    await this.prisma.$transaction(async (txc) => {
      const guard = await txc.transaction.updateMany({
        where: { id: transactionId, paymentStatus: 'HELD', confirmedDeliveryAt: null },
        data: {
          paymentStatus: 'RELEASED',
          releasedAt: now,
          confirmedDeliveryAt: now,
          deliveredAt: tx.deliveredAt ?? now,
          shippingStatus: 'DELIVERED',
        },
      });
      if (guard.count === 0) {
        throw new BadRequestException(
          'Payment is no longer in a releasable state — it may have been disputed or already released.',
        );
      }
      await txc.user.update({
        where: { id: tx.sellerId },
        data: { totalSales: { increment: 1 } },
      });
    });

    // P6.2 — the buyer just confirmed receipt of ONE physical parcel that
    // carried the whole consolidated group. Release every OTHER live line that
    // ships with it (same seller, same parcel, delivered together) so a
    // multi-item order settles on one confirmation, not one-per-item.
    const carrierId = tx.shipsWithId ?? transactionId;
    const siblingIds = (
      await this.prisma.transaction.findMany({
        where: {
          OR: [{ id: carrierId }, { shipsWithId: carrierId }],
          id: { not: transactionId },
          paymentStatus: 'HELD',
          confirmedDeliveryAt: null,
          swapId: null,
        },
        select: { id: true },
      })
    ).map((t) => t.id);
    if (siblingIds.length > 0) {
      await this.prisma.$transaction(async (txc) => {
        const rel = await txc.transaction.updateMany({
          where: {
            id: { in: siblingIds },
            paymentStatus: 'HELD',
            confirmedDeliveryAt: null,
          },
          data: {
            paymentStatus: 'RELEASED',
            releasedAt: now,
            confirmedDeliveryAt: now,
            deliveredAt: now,
            shippingStatus: 'DELIVERED',
          },
        });
        if (rel.count > 0) {
          await txc.user.update({
            where: { id: tx.sellerId },
            data: { totalSales: { increment: rel.count } },
          });
        }
      });
      for (const sid of siblingIds) {
        void this.zohoBooks.createCommissionInvoice(sid);
        void this.tracking.recordInternal(sid, 'BUYER_CONFIRMED_DELIVERY', {
          occurredAt: now,
        });
        void this.tracking.recordInternal(sid, 'PAYOUT_RELEASED', {
          occurredAt: new Date(now.getTime() + 1),
        });
        void this.sendReleasedNotification(sid);
      }
    }

    this.logger.log(`Transaction ${transactionId} delivery confirmed — payment released`);
    // P0.6 — commission invoice into Books at release. Previously only the
    // FIREARM dealer-verification hook invoiced, so the commission on every
    // ordinary courier sale never reached the books and the payout batch's
    // markCommissionInvoicePaid no-oped. Idempotent + never throws.
    void this.zohoBooks.createCommissionInvoice(transactionId);
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
      include: {
        buyer: true,
        seller: true,
        listing: { select: { title: true, testedWorkingAttestedAt: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    // SWOP — a swap leg is disputed at the Swap level (raiseSwapDispute, which
    // atomically holds the whole swap + stops auto-release), not per-leg here.
    if (tx.swapId) {
      throw new BadRequestException(
        'This is a swap — raise any issue from the swap, not the individual item.',
      );
    }
    if (tx.buyer.clerkId !== buyerClerkId) {
      throw new ForbiddenException('Only the buyer can raise a dispute');
    }
    // A dispute presupposes a paid order. paymentStatus defaults to HELD at
    // creation, so HELD is not proof of payment (a collection order bypasses
    // the dispatch gate below, which for courier orders incidentally blocked
    // unpaid disputes). Require paidAt so an unpaid checkout can't be disputed.
    if (!tx.paidAt) {
      throw new BadRequestException(
        'This order has not been paid yet, so there is nothing to dispute.',
      );
    }
    if (tx.paymentStatus !== 'HELD') {
      throw new BadRequestException(
        'Disputes can only be raised while the payment is held. This transaction is already ' +
          tx.paymentStatus.toLowerCase().replace(/_/g, ' ') + '.',
      );
    }
    // Collection orders have no dispatch step — the buyer collects in person.
    // Allow disputes on those any time funds are HELD (seller no-show, or the
    // item isn't as described at handover). Courier orders keep the
    // dispatch-first rule: there's nothing to dispute before the parcel moves,
    // and the 48h dispatch SLA auto-refunds a seller who never ships.
    if (!tx.dispatchedAt && tx.shippingMethod !== 'COLLECTION') {
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
    // P5.4 — snapshot the seller's "tested & working" claim into the dispute
    // record so the admin resolving a not-working/DAMAGED dispute sees the
    // exact CPA-relevant fact ("seller attested it worked; buyer says it
    // doesn't"). It's the seller's own claim, never a GG certification.
    const attestationLine = tx.listing.testedWorkingAttestedAt
      ? `\n[SELLER ATTESTATION — "tested & working" claimed at listing on ${tx.listing.testedWorkingAttestedAt.toISOString()}]`
      : '';
    const note = `[BUYER DISPUTE: ${reason}] ${trimmedDetails}${attestationLine}`;

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
  // Manual EFT confirmation (PAYMENT_MODE=manual)
  // ------------------------------------------------------------------
  // Called by ManualPaymentsService when the AUTHORITATIVE FNB statement
  // reconciliation confirms a buyer's EFT for `txId`. Reuses the full
  // markPaid path (atomic claim → listing SOLD → sibling-offer cleanup →
  // PAYMENT_RECEIVED timeline → sale notifications → immediate-payout for
  // PRIVATE_ARRANGE), so a manual sale is indistinguishable downstream
  // from a gateway sale. Idempotent: a no-op if already paid.
  async confirmManualPayment(txId: string): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { listing: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.paidAt) {
      this.logger.log(`confirmManualPayment: ${txId} already paid — skipping`);
      return;
    }
    // peachCheckoutId/peachPaymentId is @unique — give the manual EFT a
    // stable unique id derived from the order reference.
    const paymentId = `EFT-${tx.orderReference ?? txId}`;
    await this.markPaid(
      txId,
      {
        paymentId,
        resultCode: 'MANUAL_EFT',
        amount: tx.buyerTotal,
        currency: 'ZAR',
        merchantTransactionId: txId,
        isSuccess: true,
      },
      tx.listing,
      tx.buyerTotal,
    );
    await this.prisma.transaction.update({
      where: { id: txId },
      data: { manualVerifiedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------
  private async markPaid(
    txId: string,
    result: GatewayPaymentResult,
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

    // ─── ATOMIC idempotency guard + listing flip ──────────────────────
    // updateMany with a paidAt=null predicate so only ONE concurrent
    // caller (result-page race vs webhook race vs double-click) can flip
    // the row to paid. count===0 means another path already claimed it —
    // a successful no-op, not an error. The listing→SOLD flip is in the
    // SAME interactive transaction so we can never end up with a paid
    // transaction whose listing is still PAYMENT_PENDING (a process crash
    // between the two writes previously left that inconsistency).
    const claimed = await this.prisma.$transaction(async (txc) => {
      const claim = await txc.transaction.updateMany({
        where: { id: txId, paidAt: null },
        data: {
          paymentStatus: 'HELD',
          peachPaymentId: result.paymentId,
          peachResultCode: result.resultCode,
          paidAt,
          acceptDeadlineAt,
        },
      });
      if (claim.count === 0) return false;
      // Phase 8a: branch on the listing's own trackInventory (loaded fresh
      // here so it's correct regardless of what the caller included).
      // Legacy = the exact SOLD flip. Tracked = release the in-flight
      // reservation (quantityReserved was incremented at reserve;
      // quantityAvailable was already decremented at reserve), and flip
      // SOLD only when stock AND in-flight reservations are both exhausted.
      const L = await txc.listing.findUnique({
        where: { id: listing.id },
        select: { trackInventory: true, quantityAvailable: true, quantityReserved: true },
      });
      if (L?.trackInventory) {
        const txRow = await txc.transaction.findUnique({
          where: { id: txId },
          select: { quantity: true },
        });
        const qty = txRow?.quantity ?? 1;
        const newReserved = L.quantityReserved - qty;
        const soldOut = L.quantityAvailable <= 0 && newReserved <= 0;
        await txc.listing.update({
          where: { id: listing.id },
          data: {
            quantityReserved: { decrement: qty },
            ...(soldOut
              ? { status: 'SOLD', soldAt: new Date() }
              : L.quantityAvailable > 0
                ? { status: 'ACTIVE' }
                : {}),
          },
        });
      } else {
        await txc.listing.update({
          where: { id: listing.id },
          data: { status: 'SOLD', soldAt: new Date() },
        });
      }
      return true;
    });
    if (!claimed) {
      this.logger.log(
        `markPaid: transaction ${txId} was already claimed by another path — skipping`,
      );
      return;
    }

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

    // P5.2 — alert everyone who wishlisted this item that it sold (with a link
    // to similar listings). Fire-and-forget; the method re-reads the listing and
    // no-ops unless it's genuinely SOLD (a multi-buy sale that didn't exhaust
    // stock leaves the listing ACTIVE and must NOT alert), and excludes the
    // seller + this buyer.
    void this.wishlistAlerts
      .notifyItemSold(listing.id, txId)
      .catch((e) =>
        this.logger.warn(
          `wishlist item-sold alert failed for ${listing.id}: ${(e as Error).message}`,
        ),
      );

    // Fire-and-forget fraud-risk scoring — log-only, post-capture, never
    // blocks payment (its own try/catch swallows everything).
    void this.fraudRisk.evaluate(txId);
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

      // FLOW-F4 (H21) — PA is a release point like confirm-delivery and admin
      // release, so it must raise the commission invoice too. Previously the
      // only PA-reachable hooks (confirmDelivery / dealer-verify) never fire
      // for PRIVATE_ARRANGE (funds already released here), so every PA
      // commission went uninvoiced. Idempotent + never throws; the FNB payout
      // batch marks it paid when the settlement lands, exactly like a courier
      // sale.
      void this.zohoBooks.createCommissionInvoice(txId);

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
          // Pull the listing's category too so the firearm SAP 534 flow
          // can tell a barrel listing apart (serial goes on the Barrel
          // line vs the Frame line on the form).
          listing: { include: { category: true } },
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
        // Buyer "order confirmed" — SKIPPED for multi-item order children
        // (tx.orderId set). confirmManualOrder sends ONE consolidated buyer
        // confirmation after every line of the cart is paid, so the buyer
        // isn't emailed/SMSed N times for one order. Single-item sales
        // (orderId null — every Phase 1–7 sale) keep the per-tx confirmation.
        tx.orderId
          ? Promise.resolve()
          : this.notifications.orderConfirmedBuyer(details),
        this.notifications.newSaleSeller(details),
      ]);

      // ─── Phase 3: SAP 534 prefilled form for firearm dealer-transfer ──
      // When a FIREARM sells via DEALER_TRANSFER, prefill the SAPS 534
      // "Transfer of Firearm Ownership" PDF with the particulars we hold
      // and email it (attached) to the seller + drop an action-required
      // inbox row to complete + upload it back.
      //
      // FULLY FIRE-AND-FORGET + wrapped: sap534ForSeller is itself
      // non-throwing, but we still belt-and-braces it here (await inside
      // the outer try, and the whole thing void-fired isn't necessary
      // because the outer catch already swallows). This must NEVER break
      // the payment finalisation.
      if (tx.listing.isFirearm && tx.shippingMethod === 'DEALER_TRANSFER') {
        try {
          const cat = tx.listing.category;
          const isBarrel =
            /barrel/i.test(cat?.name ?? '') || /barrel/i.test(cat?.slug ?? '');
          await this.notifications.sap534ForSeller({
            sellerEmail: tx.seller.email,
            sellerName: details.sellerName,
            sellerPhone: tx.seller.phone,
            listingTitle: tx.listing.title,
            transactionId: txId,
            orderReference:
              tx.orderReference ?? txId.slice(-8).toUpperCase(),
            form: {
              // ─── Section C (seller / current owner) ───
              surname: tx.seller.lastName,
              firstNames: tx.seller.firstName,
              idNumber: this.readSellerIdNumber(tx.seller.idNumberEncrypted),
              // Compose a single-line residential address from the
              // seller's stored address parts.
              residentialAddress: [
                tx.seller.addrBuilding,
                tx.seller.addrStreet,
                tx.seller.addrAddress2,
                tx.seller.addrSuburb,
                tx.seller.addrCity,
              ]
                .filter(Boolean)
                .join(', '),
              residentialPostalCode: tx.seller.addrPostalCode,
              // We only hold one address on User — reuse it for the
              // postal address too (seller can amend by hand if needed).
              postalAddress: [
                tx.seller.addrBuilding,
                tx.seller.addrStreet,
                tx.seller.addrAddress2,
                tx.seller.addrSuburb,
                tx.seller.addrCity,
              ]
                .filter(Boolean)
                .join(', '),
              postalPostalCode: tx.seller.addrPostalCode,
              cellPhone: tx.seller.phone,
              email: tx.seller.email,
              // ─── Section D (firearm) ───
              calibre: tx.listing.calibre,
              make: tx.listing.make,
              model: tx.listing.model,
              serialNumber: tx.listing.serialNumber,
              isBarrel,
            },
          });
        } catch (err) {
          this.logger.error(
            `SAP 534 dispatch failed for ${txId}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`sendSaleNotifications failed for ${txId}: ${(err as Error).message}`);
    }
  }

  // Decrypt the seller's at-rest SA ID number for the SAP 534 form.
  // Returns null (never throws) when the column is empty (purged after
  // KYC for non-firearm sellers, or never captured) or the ciphertext
  // can't be read — the form is simply left with a blank ID line in
  // that case, which the seller fills by hand. We do NOT block the
  // email on a missing ID.
  private readSellerIdNumber(
    idNumberEncrypted: string | null | undefined,
  ): string | null {
    if (!idNumberEncrypted) return null;
    try {
      // Lazy import keeps the crypto module off the boot path.

      const { decryptSaIdNumber } = require('../common/id-crypto') as {
        decryptSaIdNumber: (s: string) => string;
      };
      return decryptSaIdNumber(idNumberEncrypted);
    } catch (err) {
      this.logger.warn(
        `readSellerIdNumber: could not decrypt stored SA ID — leaving form ID blank: ${(err as Error).message}`,
      );
      return null;
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
    collectionOnly: boolean,
    sellerOffered: ShippingMethod[],
    chosen: ShippingMethod,
  ) {
    // 0. Collection-only listings (trailers / off-road caravans / oversized
    //    goods no courier will carry). The ONLY legal method is in-person
    //    COLLECTION — and conversely COLLECTION is never valid for a
    //    courier/firearm listing (it would bypass a real shipment + skip the
    //    courier rate). This is the collection analogue of the firearm gate.
    if (collectionOnly) {
      if (chosen !== 'COLLECTION') {
        throw new BadRequestException(
          'This item is collection-only — it must be collected in person.',
        );
      }
      return;
    }
    if (chosen === 'COLLECTION') {
      throw new BadRequestException(
        'In-person collection is only available for collection-only listings.',
      );
    }
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
