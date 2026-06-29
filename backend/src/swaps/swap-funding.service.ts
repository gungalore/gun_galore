import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  SwapStatus,
  SwapRole,
  ListingStatus,
  PaymentStatus,
  ShippingMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingService } from '../shipping/shipping.service';
import { FeeCalculator } from '../payments/fee.calculator';
import { PAYMENT_MODE, GG_BANK_DETAILS } from '../payments/transactions.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SwapDeliveryDto } from './dto/swap-delivery.dto';

// How long both parties have to fund after setup. Two people must coordinate
// an EFT each, so a few days is reasonable (vs the 1h single-buyer freeze).
const FUNDING_WINDOW_HOURS = 72;

// A booked swap leg that's still uncollected after this many days → the swap
// is flagged DISPUTED for admin review (a party didn't drop their parcel).
const SHIP_SLA_DAYS = 7;

// After both legs deliver, recipients get this long to flag "not as described"
// before the cash auto-releases. Kept in sync with the deadline stamped by the
// shipping rollup (shipping.service.applyShippingUpdate).
const VERIFICATION_WINDOW_HOURS = 48;

type Side = 'INITIATOR' | 'OWNER';

/**
 * SWOP S3 — two-sided manual-EFT funding rail. Each party funds the leg they
 * SEND (live courier + flat R50 fee + any cash they owe; the 1.5% EFT handling
 * is absorbed by GG). BOTH must fund for the swap to LOCK; if one funds and the
 * other lapses, the funded party is fully reimbursed via the FNB refund batch.
 *
 * v1 ships door-to-door (TCG) so only a street address is needed — no locker
 * selection. Gated to PAYMENT_MODE=manual (the live path; the dormant paygate
 * seam is on the Swap schema for later).
 */
@Injectable()
export class SwapFundingService {
  private readonly logger = new Logger(SwapFundingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
    private readonly fees: FeeCalculator,
    private readonly referenceNumbers: ReferenceNumberService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------------
  // Each party submits the delivery address for the leg they RECEIVE.
  //   initiator receives the OWNER_GIVES leg (owner's item → initiator)
  //   owner     receives the INITIATOR_GIVES leg (initiator's item → owner)
  // Once both addresses are in, funding is quoted + set up automatically.
  // ----------------------------------------------------------------
  async submitDeliveryAddress(
    clerkId: string,
    swapId: string,
    dto: SwapDeliveryDto,
  ) {
    if (PAYMENT_MODE !== 'manual') {
      throw new BadRequestException('Swap funding is not available right now.');
    }
    const { swap, side } = await this.loadForParty(clerkId, swapId);
    if (swap.status !== SwapStatus.AWAITING_FUNDING) {
      throw new BadRequestException('This swap is not awaiting funding.');
    }
    if (swap.fundingSetUpAt) {
      throw new BadRequestException(
        'Funding is already set up — check your payment instructions.',
      );
    }

    // The caller is the RECIPIENT of the opposite party's leg.
    const recipientRole =
      side === 'INITIATOR' ? SwapRole.OWNER_GIVES : SwapRole.INITIATOR_GIVES;
    const leg = swap.transactions.find((t) => t.swapRole === recipientRole);
    if (!leg) throw new NotFoundException('Swap leg missing');
    // S6 — a firearm leg transfers via a licensed dealer (the SENDER stocks it
    // in + uploads the SAPS 534; the recipient collects from that dealer), so
    // there is no street-delivery address to capture.
    if (leg.listing?.isFirearm) {
      throw new BadRequestException(
        'This is a firearm — it transfers via a licensed dealer, so no delivery address is needed. Just pay your share once funding is ready.',
      );
    }

    await this.prisma.transaction.update({
      where: { id: leg.id },
      data: {
        shippingMethod: ShippingMethod.TCG, // v1 = door-to-door
        deliveryAddress: {
          streetAddress: dto.street,
          building: dto.building ?? null,
          address2: dto.address2 ?? null,
          suburb: dto.suburb,
          city: dto.city,
          postalCode: dto.postalCode,
          province: dto.province,
          lat: dto.lat ?? 0,
          lng: dto.lng ?? 0,
        },
      },
    });

    // All legs ready? (firearm legs need no address.) Quote + set up funding.
    await this.maybeSetUpFunding(swapId);
    return this.getFundingState(clerkId, swapId);
  }

  // Fire funding setup once EVERY leg is "address-ready": a courier leg needs
  // its recipient's street address; a firearm leg needs nothing (dealer
  // transfer). Called from each address submit AND from convertToSwap (so an
  // all-firearm swap, which has no address step, still gets set up). No-ops
  // until ready / if already set up — safe to call repeatedly.
  async maybeSetUpFunding(swapId: string) {
    if (PAYMENT_MODE !== 'manual') return;
    const swap = await this.prisma.swap.findUnique({
      where: { id: swapId },
      select: {
        status: true,
        fundingSetUpAt: true,
        transactions: {
          select: {
            swapRole: true,
            deliveryAddress: true,
            swapProofStatus: true,
            listing: { select: { isFirearm: true } },
          },
        },
      },
    });
    if (
      !swap ||
      swap.status !== SwapStatus.AWAITING_FUNDING ||
      swap.fundingSetUpAt
    ) {
      return;
    }
    const realLegs = swap.transactions.filter((t) => t.swapRole != null);
    if (realLegs.length !== 2) return;
    // Each leg must be (a) proof-of-possession APPROVED — the item was shown to
    // exist with our per-leg code — AND (b) address-ready (courier legs need
    // the recipient's address; firearm legs go via a dealer, no address). Only
    // then do we set up funding, so nobody pays or ships for a phantom item.
    const allReady = realLegs.every(
      (t) =>
        t.swapProofStatus === 'APPROVED' &&
        (t.listing?.isFirearm ? true : t.deliveryAddress != null),
    );
    if (allReady) await this.ensureFundingSetUp(swapId);
  }

  // ----------------------------------------------------------------
  // Quote both legs + compute per-party amounts + allocate refs + set the
  // deadline. Claim-guarded (fundingSetUpAt) so it runs exactly once; rolls
  // the claim back if a live carrier quote fails so it can be retried.
  // ----------------------------------------------------------------
  async ensureFundingSetUp(swapId: string) {
    // Proof-of-possession gate — enforced HERE (the single chokepoint every
    // path reaches, including the /funding/retry endpoint that calls this
    // directly) so funding can never be set up — and nothing paid or shipped —
    // until BOTH items are photo-verified with their GG code. Checked before
    // the claim so a fail leaves no half-set-up state + gives a clear message.
    const proofLegs = await this.prisma.transaction.findMany({
      where: { swapId, swapRole: { not: null } },
      select: { swapProofStatus: true },
    });
    if (
      proofLegs.length < 2 ||
      !proofLegs.every((l) => l.swapProofStatus === 'APPROVED')
    ) {
      throw new BadRequestException(
        'Both items must be photo-verified before funding can be set up.',
      );
    }

    const claimedAt = new Date();
    const claim = await this.prisma.swap.updateMany({
      where: {
        id: swapId,
        status: SwapStatus.AWAITING_FUNDING,
        fundingSetUpAt: null,
      },
      data: { fundingSetUpAt: claimedAt },
    });
    if (claim.count === 0) return; // already set up / not eligible

    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: {
          transactions: {
            select: {
              id: true,
              swapRole: true,
              listingId: true,
              deliveryAddress: true,
              listing: { select: { isFirearm: true } },
            },
          },
        },
      });
      if (!swap) throw new NotFoundException('Swap not found');

      const initiatorGives = swap.transactions.find(
        (t) => t.swapRole === SwapRole.INITIATOR_GIVES,
      );
      const ownerGives = swap.transactions.find(
        (t) => t.swapRole === SwapRole.OWNER_GIVES,
      );
      if (!initiatorGives || !ownerGives) {
        throw new BadRequestException('Swap legs incomplete');
      }
      const initiatorIsFirearm = !!initiatorGives.listing?.isFirearm;
      const ownerIsFirearm = !!ownerGives.listing?.isFirearm;
      // Courier legs need the recipient's street address; firearm legs go via a
      // dealer (no address).
      if (
        (!initiatorIsFirearm && !initiatorGives.deliveryAddress) ||
        (!ownerIsFirearm && !ownerGives.deliveryAddress)
      ) {
        throw new BadRequestException('Both delivery addresses are required');
      }

      // Each party funds the leg they SEND. A courier leg is quoted to the
      // recipient's address; a firearm leg has no carrier cost — its flat
      // dealer-handling fee (R100) is applied via breakdownSwapLeg(isFirearm).
      const initiatorQuote = initiatorIsFirearm
        ? { priceCents: 0, serviceCode: null as string | null }
        : await this.quoteLeg(
            initiatorGives.listingId,
            initiatorGives.deliveryAddress,
          );
      const ownerQuote = ownerIsFirearm
        ? { priceCents: 0, serviceCode: null as string | null }
        : await this.quoteLeg(ownerGives.listingId, ownerGives.deliveryAddress);

      const initiatorCash =
        swap.cashPayerId === swap.initiatorId ? swap.cashAmount : 0;
      const ownerCash = swap.cashPayerId === swap.ownerId ? swap.cashAmount : 0;

      const initiatorBd = this.fees.breakdownSwapLeg(
        initiatorQuote.priceCents,
        initiatorCash,
        initiatorIsFirearm,
        'manual',
      );
      const ownerBd = this.fees.breakdownSwapLeg(
        ownerQuote.priceCents,
        ownerCash,
        ownerIsFirearm,
        'manual',
      );

      const [initiatorRef, ownerRef] = await Promise.all([
        this.referenceNumbers.allocateOrderReference('SWOP'),
        this.referenceNumbers.allocateOrderReference('SWOP'),
      ]);

      const payByAt = new Date(
        claimedAt.getTime() + FUNDING_WINDOW_HOURS * 3_600_000,
      );

      await this.prisma.$transaction([
        // Snapshot the quote onto each sending leg (S4 booking reuses it).
        this.prisma.transaction.update({
          where: { id: initiatorGives.id },
          data: {
            shippingCost: initiatorQuote.priceCents,
            shippingServiceCode: initiatorQuote.serviceCode,
            shippingMethod: initiatorIsFirearm
              ? ShippingMethod.DEALER_TRANSFER
              : ShippingMethod.TCG,
          },
        }),
        this.prisma.transaction.update({
          where: { id: ownerGives.id },
          data: {
            shippingCost: ownerQuote.priceCents,
            shippingServiceCode: ownerQuote.serviceCode,
            shippingMethod: ownerIsFirearm
              ? ShippingMethod.DEALER_TRANSFER
              : ShippingMethod.TCG,
          },
        }),
        this.prisma.swap.update({
          where: { id: swapId },
          data: {
            cashPayByAt: payByAt,
            initiatorFundingRef: initiatorRef,
            initiatorFundingAmount: initiatorBd.partyTotal,
            initiatorCourierCents: initiatorQuote.priceCents,
            ownerFundingRef: ownerRef,
            ownerFundingAmount: ownerBd.partyTotal,
            ownerCourierCents: ownerQuote.priceCents,
          },
        }),
      ]);

      void this.notifyFundingReady(swapId);
    } catch (err) {
      // Roll the claim back so a retry (or the next address resubmit) can
      // re-quote. Never leave a swap "set up" without amounts.
      await this.prisma.swap.updateMany({
        where: { id: swapId, fundingSetUpAt: claimedAt, initiatorFundingRef: null },
        data: { fundingSetUpAt: null },
      });
      this.logger.error(`ensureFundingSetUp failed for ${swapId}: ${(err as Error).message}`);
      throw new BadRequestException(
        'Could not price the swap shipping just now — please try again in a moment.',
      );
    }
  }

  private async quoteLeg(listingId: string, deliveryAddress: unknown) {
    const a = deliveryAddress as {
      streetAddress: string;
      suburb: string;
      city: string;
      postalCode: string;
      province: string;
      lat?: number;
      lng?: number;
    };
    return this.shipping.quoteForListing({
      listingId,
      shippingMethod: ShippingMethod.TCG,
      deliveryAddress: {
        streetAddress: a.streetAddress,
        suburb: a.suburb,
        city: a.city,
        postalCode: a.postalCode,
        province: a.province as never,
        lat: a.lat ?? 0,
        lng: a.lng ?? 0,
      },
    });
  }

  // ----------------------------------------------------------------
  // Reconciler hooks (called from ManualPaymentsService).
  // ----------------------------------------------------------------

  // Provisional inContact match — stop the funding sweep for this side.
  async markFundingDetected(swapId: string, side: Side) {
    const now = new Date();
    if (side === 'INITIATOR') {
      await this.prisma.swap.updateMany({
        where: { id: swapId, initiatorDetectedAt: null },
        data: { initiatorDetectedAt: now },
      });
    } else {
      await this.prisma.swap.updateMany({
        where: { id: swapId, ownerDetectedAt: null },
        data: { ownerDetectedAt: now },
      });
    }
  }

  // Authoritative statement match — this side is funded. Both funded → LOCK.
  async confirmSwapFunding(swapId: string, side: Side) {
    const now = new Date();
    const claim =
      side === 'INITIATOR'
        ? await this.prisma.swap.updateMany({
            where: {
              id: swapId,
              status: SwapStatus.AWAITING_FUNDING,
              initiatorVerifiedAt: null,
            },
            data: { initiatorVerifiedAt: now, initiatorDetectedAt: now },
          })
        : await this.prisma.swap.updateMany({
            where: {
              id: swapId,
              status: SwapStatus.AWAITING_FUNDING,
              ownerVerifiedAt: null,
            },
            data: { ownerVerifiedAt: now, ownerDetectedAt: now },
          });
    if (claim.count === 0) return; // already verified / not awaiting
    await this.tryLock(swapId);
  }

  // Atomic both-verified → LOCKED. The WHERE does the both-verified check as
  // part of the write (no read-then-branch), so whichever side commits its
  // verify second wins the lock exactly once; the status guard makes it
  // idempotent. Replaces the prior findUnique-then-updateMany, which could
  // (a) leave a fully-funded swap stuck AWAITING_FUNDING under two concurrent
  // confirms each reading the other's column as still-null, or (b) wedge on a
  // crash between the verify-write and the lock-write.
  private async tryLock(swapId: string) {
    const lock = await this.prisma.swap.updateMany({
      where: {
        id: swapId,
        status: SwapStatus.AWAITING_FUNDING,
        initiatorVerifiedAt: { not: null },
        ownerVerifiedAt: { not: null },
      },
      data: { status: SwapStatus.LOCKED, lockedAt: new Date() },
    });
    if (lock.count > 0) {
      this.logger.log(`Swap ${swapId} fully funded → LOCKED`);
      void this.onSwapLocked(swapId);
    }
  }

  // On LOCK (S4): notify both parties, book BOTH legs via the live
  // platform-arranged courier path (bookForTransaction — fail-safe +
  // idempotent + courier-only; each SENDER gets their own waybill/PIN via the
  // shipmentBooked SMS/email it fires), then flip LOCKED → IN_TRANSIT. Booking
  // failures raise their own admin alert and never wedge the swap.
  private async onSwapLocked(swapId: string) {
    void this.notifyLocked(swapId);
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        select: { transactions: { select: { id: true } } },
      });
      if (!swap) return;
      for (const leg of swap.transactions) {
        void this.shipping
          .bookForTransaction(leg.id)
          .catch((e) =>
            this.logger.warn(
              `swap leg booking failed ${leg.id}: ${(e as Error).message}`,
            ),
          );
      }
      await this.prisma.swap.updateMany({
        where: { id: swapId, status: SwapStatus.LOCKED },
        data: { status: SwapStatus.IN_TRANSIT },
      });
    } catch (err) {
      this.logger.error(`onSwapLocked failed for ${swapId}: ${(err as Error).message}`);
    }
  }

  // Self-heal: promote any swap that has both sides verified but is somehow
  // still AWAITING_FUNDING (e.g. a crash between the verify-write and the
  // lock-write) → LOCKED. Run from the funding sweep cron BEFORE the cancel
  // pass, so a fully-funded swap is never eligible for cancellation.
  private async relockFullyFunded() {
    const ready = await this.prisma.swap.findMany({
      where: {
        status: SwapStatus.AWAITING_FUNDING,
        initiatorVerifiedAt: { not: null },
        ownerVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    for (const s of ready) await this.tryLock(s.id);
  }

  // ----------------------------------------------------------------
  // Funding state for the SwapPanel (caller's own side).
  // ----------------------------------------------------------------
  async getFundingState(clerkId: string, swapId: string) {
    const { swap, side } = await this.loadForParty(clerkId, swapId);
    const mine = side === 'INITIATOR';
    const myAddrRole = mine ? SwapRole.OWNER_GIVES : SwapRole.INITIATOR_GIVES;
    const myAddrLeg = swap.transactions.find((t) => t.swapRole === myAddrRole);
    return {
      swapId: swap.id,
      status: swap.status,
      side,
      fundingSetUp: !!swap.fundingSetUpAt,
      payByAt: swap.cashPayByAt?.toISOString() ?? null,
      myDeliveryProvided: !!myAddrLeg?.deliveryAddress,
      myAmountCents: mine ? swap.initiatorFundingAmount : swap.ownerFundingAmount,
      myReference: mine ? swap.initiatorFundingRef : swap.ownerFundingRef,
      myFunded: !!(mine ? swap.initiatorVerifiedAt : swap.ownerVerifiedAt),
      counterpartyFunded: !!(mine ? swap.ownerVerifiedAt : swap.initiatorVerifiedAt),
      verificationDeadlineAt: swap.verificationDeadlineAt?.toISOString() ?? null,
      disputeReason: swap.disputeReason ?? null,
    };
  }

  // All of the caller's in-flight swaps — drives the /my/swaps page.
  async getMySwaps(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { bankDetails: GG_BANK_DETAILS, swaps: [] };
    const swaps = await this.prisma.swap.findMany({
      where: {
        OR: [{ initiatorId: user.id }, { ownerId: user.id }],
        status: {
          in: [
            SwapStatus.AWAITING_FUNDING,
            SwapStatus.LOCKED,
            SwapStatus.IN_TRANSIT,
            SwapStatus.AWAITING_VERIFICATION,
            SwapStatus.DISPUTED,
          ],
        },
      },
      include: {
        transactions: {
          select: {
            id: true,
            swapRole: true,
            dealerVerificationStatus: true,
            swapProofCode: true,
            swapProofStatus: true,
            listing: {
              select: {
                id: true,
                title: true,
                isFirearm: true,
                images: { where: { isPrimary: true }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const mapped = swaps.map((s) => {
      const mine = s.initiatorId === user.id;
      const myGiveRole = mine ? SwapRole.INITIATOR_GIVES : SwapRole.OWNER_GIVES;
      const myGetRole = mine ? SwapRole.OWNER_GIVES : SwapRole.INITIATOR_GIVES;
      const giveLeg = s.transactions.find((t) => t.swapRole === myGiveRole);
      const getLeg = s.transactions.find((t) => t.swapRole === myGetRole);
      const give = giveLeg?.listing;
      const get = getLeg?.listing;
      return {
        swapId: s.id,
        status: s.status,
        side: mine ? 'INITIATOR' : 'OWNER',
        fundingSetUp: !!s.fundingSetUpAt,
        payByAt: s.cashPayByAt?.toISOString() ?? null,
        myAmountCents: mine ? s.initiatorFundingAmount : s.ownerFundingAmount,
        myReference: mine ? s.initiatorFundingRef : s.ownerFundingRef,
        myFunded: !!(mine ? s.initiatorVerifiedAt : s.ownerVerifiedAt),
        counterpartyFunded: !!(mine ? s.ownerVerifiedAt : s.initiatorVerifiedAt),
        verificationDeadlineAt: s.verificationDeadlineAt?.toISOString() ?? null,
        disputeReason: s.disputeReason ?? null,
        give: give
          ? { title: give.title, imageUrl: give.images[0]?.url ?? null }
          : null,
        get: get
          ? { title: get.title, imageUrl: get.images[0]?.url ?? null }
          : null,
        // S6 — firearm legs route through a dealer. For the leg the caller
        // SENDS, surface the txId + dealer-verify status so /my/swaps can
        // prompt them to stock it in + upload the SAPS 534. getIsFirearm tells
        // the recipient their incoming item comes via a dealer.
        giveLegId: giveLeg?.id ?? null,
        giveIsFirearm: !!give?.isFirearm,
        giveDealerVerificationStatus: giveLeg?.dealerVerificationStatus ?? null,
        getIsFirearm: !!get?.isFirearm,
        // Proof-of-possession for the leg the caller SENDS (drives the
        // "verify your item" step on /my/swaps).
        giveProofCode: giveLeg?.swapProofCode ?? null,
        giveProofStatus: giveLeg?.swapProofStatus ?? null,
      };
    });
    return { bankDetails: GG_BANK_DETAILS, swaps: mapped };
  }

  // ----------------------------------------------------------------
  // Cron — funding deadline lapsed unfunded → cancel + restock + reimburse
  // any side that DID pay (synthetic REFUNDED tx → FNB refund batch).
  // ----------------------------------------------------------------
  async sweepExpiredFunding() {
    if (PAYMENT_MODE !== 'manual') return;
    // Self-heal first: promote any both-verified-but-not-locked swap to LOCKED
    // (crash between the verify-write and the lock-write) so a fully funded
    // swap is never in the cancel-eligible set below.
    await this.relockFullyFunded();

    const now = new Date();
    const stale = await this.prisma.swap.findMany({
      where: {
        status: SwapStatus.AWAITING_FUNDING,
        fundingSetUpAt: { not: null },
        cashPayByAt: { not: null, lt: now },
        // A side is "unfunded" only if it is NEITHER verified NOR provisionally
        // detected (inContact). Only sweep when at least one side is fully
        // un-actioned — never cancel out from under a payment that's already
        // detected but not yet statement-verified. (Mirrors the single-item
        // freeze sweep, which gates on manualDetectedAt:null.)
        OR: [
          { AND: [{ initiatorVerifiedAt: null }, { initiatorDetectedAt: null }] },
          { AND: [{ ownerVerifiedAt: null }, { ownerDetectedAt: null }] },
        ],
      },
      include: {
        transactions: { select: { swapRole: true, listingId: true } },
      },
      take: 50,
    });

    for (const swap of stale) {
      try {
        // Cancel + restock + reimburse all commit together, so a mid-sweep
        // crash can never leave a CANCELLED swap with the funded party
        // un-refunded (CANCELLED is terminal + the sweep only re-examines
        // AWAITING_FUNDING). Returns false if another path won the row first.
        const cancelled = await this.prisma.$transaction(async (txc) => {
          // Atomic claim — guarded on status AND not-both-verified, so a fully
          // funded swap can never be cancelled even if it slipped the relock.
          const claim = await txc.swap.updateMany({
            where: {
              id: swap.id,
              status: SwapStatus.AWAITING_FUNDING,
              OR: [{ initiatorVerifiedAt: null }, { ownerVerifiedAt: null }],
            },
            data: {
              status: SwapStatus.CANCELLED,
              cancelledAt: now,
              cancelledReason: 'funding-not-completed',
            },
          });
          if (claim.count === 0) return false;

          await txc.listing.updateMany({
            where: {
              id: { in: swap.transactions.map((t) => t.listingId) },
              status: ListingStatus.PAYMENT_PENDING,
            },
            data: { status: ListingStatus.ACTIVE },
          });

          // Re-read FRESH funding flags inside the tx — a one-sided verify can
          // commit between the snapshot above and this claim; the snapshot
          // would wrongly skip refunding the now-verified side.
          const fresh = await txc.swap.findUnique({
            where: { id: swap.id },
            select: {
              initiatorId: true,
              ownerId: true,
              initiatorVerifiedAt: true,
              ownerVerifiedAt: true,
              initiatorRefundedAt: true,
              ownerRefundedAt: true,
              initiatorFundingAmount: true,
              ownerFundingAmount: true,
              initiatorFundingRef: true,
              ownerFundingRef: true,
            },
          });
          if (!fresh) return true;
          if (fresh.initiatorVerifiedAt && !fresh.initiatorRefundedAt) {
            await this.refundSide(txc, swap.id, 'INITIATOR', fresh, swap.transactions);
          }
          if (fresh.ownerVerifiedAt && !fresh.ownerRefundedAt) {
            await this.refundSide(txc, swap.id, 'OWNER', fresh, swap.transactions);
          }
          return true;
        });

        if (cancelled) {
          this.logger.log(
            `Swap ${swap.id} funding lapsed → CANCELLED; listings released`,
          );
          void this.notifyFundingCancelled(swap.id);
        }
      } catch (err) {
        this.logger.warn(
          `swap funding sweep failed for ${swap.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // Reimburse one funded side IN FULL via a synthetic REFUNDED Transaction
  // (swapId set, so the orphan-reclaim sweep's swapId:null guard never deletes
  // it) — picked up by the FNB refund batch. Runs INSIDE the cancel
  // transaction so the *RefundedAt stamp + the synthetic tx commit atomically
  // with the cancel (no crash window strands the money).
  private async refundSide(
    txc: Prisma.TransactionClient,
    swapId: string,
    side: Side,
    fresh: {
      initiatorId: string;
      ownerId: string;
      initiatorFundingAmount: number;
      ownerFundingAmount: number;
      initiatorFundingRef: string | null;
      ownerFundingRef: string | null;
    },
    legs: { swapRole: SwapRole | null; listingId: string }[],
  ) {
    const mine = side === 'INITIATOR';
    const amount = mine ? fresh.initiatorFundingAmount : fresh.ownerFundingAmount;
    if (amount <= 0) return;
    const ref = mine ? fresh.initiatorFundingRef : fresh.ownerFundingRef;
    const refundedUserId = mine ? fresh.initiatorId : fresh.ownerId;
    const counterpartyId = mine ? fresh.ownerId : fresh.initiatorId;
    const sentRole = mine ? SwapRole.INITIATOR_GIVES : SwapRole.OWNER_GIVES;
    const sentLeg = legs.find((l) => l.swapRole === sentRole) ?? legs[0];
    if (!sentLeg) return;

    // Idempotent stamp — only create the refund once per side.
    const guard = mine
      ? await txc.swap.updateMany({
          where: { id: swapId, initiatorRefundedAt: null },
          data: { initiatorRefundedAt: new Date() },
        })
      : await txc.swap.updateMany({
          where: { id: swapId, ownerRefundedAt: null },
          data: { ownerRefundedAt: new Date() },
        });
    if (guard.count === 0) return;

    await txc.transaction.create({
      data: {
        swapId,
        listingId: sentLeg.listingId,
        buyerId: refundedUserId, // gets the money back (FNB batch pays the buyer)
        sellerId: counterpartyId,
        orderReference: ref ? `${ref}-RF` : null,
        listingPrice: 0,
        commissionZar: 0,
        processingFee: 0,
        passFeeToBuyer: false,
        buyerTotal: amount,
        sellerPayout: 0,
        refundedAmount: amount,
        paymentStatus: PaymentStatus.REFUNDED,
        lastRefundAt: new Date(),
      },
    });
    this.logger.log(
      `Swap ${swapId} ${side} reimbursed ${amount}c (synthetic refund tx)`,
    );
  }

  // ----------------------------------------------------------------
  // Cron — a LOCKED+booked swap where one party never moved their item
  // (SLA days after lock) → DISPUTED (admin-owned; cash stays held, NO
  // auto-refund — mirrors the accept-timeout precedent). Covers BOTH a courier
  // leg never collected AND a firearm (DEALER_TRANSFER) leg the sender never
  // stocked in at a dealer (deliveredAt still null — set only by the courier
  // event or the dealer-verify APPROVED path).
  // ----------------------------------------------------------------
  async sweepStalledSwapShipping() {
    if (PAYMENT_MODE !== 'manual') return;
    const cutoff = new Date(Date.now() - SHIP_SLA_DAYS * 86_400_000);
    const stalled = await this.prisma.swap.findMany({
      where: {
        status: SwapStatus.IN_TRANSIT,
        lockedAt: { not: null, lt: cutoff },
        transactions: {
          some: {
            swapRole: { not: null },
            OR: [
              // courier leg booked but never collected
              {
                shipmentBookedAt: { not: null },
                OR: [{ shippingStatus: null }, { shippingStatus: 'PENDING' }],
              },
              // firearm leg never dealer-verified (deliveredAt set on APPROVED)
              {
                shippingMethod: ShippingMethod.DEALER_TRANSFER,
                deliveredAt: null,
              },
            ],
          },
        },
      },
      select: { id: true },
      take: 50,
    });
    for (const s of stalled) {
      try {
        const claim = await this.prisma.swap.updateMany({
          where: { id: s.id, status: SwapStatus.IN_TRANSIT },
          data: { status: SwapStatus.DISPUTED },
        });
        if (claim.count === 0) continue;
        await this.prisma.adminAlert
          .create({
            data: {
              type: 'swap-shipping-stalled',
              referenceId: s.id,
              context: `Swap ${s.id}: a leg was booked but not collected after ${SHIP_SLA_DAYS} days — funds held, needs admin review.`,
              urgent: true,
            },
          })
          .catch(() => undefined);
        this.logger.warn(`Swap ${s.id} shipping stalled → DISPUTED (admin-owned)`);
      } catch (err) {
        this.logger.warn(
          `swap shipping SLA sweep failed for ${s.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ================================================================
  // S5 — cash release + completion
  // ================================================================

  // Settle the swap EXACTLY ONCE. The atomic claim flips status → COMPLETED
  // and stamps cashReleasedAt (the single "money has moved" guard) in one
  // write, so whichever path arrives first (auto-release cron / admin
  // force-complete) wins and the rest no-op. If there's a cash top-up it's
  // paid to the cash RECIPIENT via a synthetic RELEASED payout tx (picked up
  // by the FNB payout batch — paymentStatus RELEASED + sellerPayout>0); GG
  // keeps the two flat fees already collected up front, never deducted from
  // cash. Both parties get totalSales++. All in one transaction so a crash
  // can never complete-without-paying or pay-twice.
  private async releaseSwap(
    swapId: string,
    fromStatuses: SwapStatus[],
  ): Promise<{ released: boolean; settlementTxId: string | null }> {
    const now = new Date();
    return this.prisma.$transaction(async (txc) => {
      const claim = await txc.swap.updateMany({
        where: {
          id: swapId,
          status: { in: fromStatuses },
          cashReleasedAt: null,
        },
        data: {
          status: SwapStatus.COMPLETED,
          completedAt: now,
          cashReleasedAt: now,
        },
      });
      if (claim.count === 0) return { released: false, settlementTxId: null };

      const swap = await txc.swap.findUnique({
        where: { id: swapId },
        select: {
          initiatorId: true,
          ownerId: true,
          cashPayerId: true,
          cashAmount: true,
          initiatorFundingRef: true,
          ownerFundingRef: true,
          transactions: {
            select: { id: true, sellerId: true, listingId: true, swapRole: true },
          },
        },
      });
      if (!swap) return { released: true, settlementTxId: null };

      // Both parties complete a sale.
      await txc.user.update({
        where: { id: swap.initiatorId },
        data: { totalSales: { increment: 1 } },
      });
      await txc.user.update({
        where: { id: swap.ownerId },
        data: { totalSales: { increment: 1 } },
      });

      let settlementTxId: string | null = null;
      if (swap.cashAmount > 0 && swap.cashPayerId) {
        const payeeId =
          swap.cashPayerId === swap.initiatorId ? swap.ownerId : swap.initiatorId;
        // The (required) listingId link — use a REAL leg the payee is part of.
        const realLegs = swap.transactions.filter((t) => t.swapRole != null);
        const payeeLeg =
          realLegs.find((t) => t.sellerId === payeeId) ?? realLegs[0];
        const payeeRef =
          payeeId === swap.initiatorId
            ? swap.initiatorFundingRef
            : swap.ownerFundingRef;
        const created = await txc.transaction.create({
          data: {
            swapId,
            listingId: payeeLeg.listingId,
            sellerId: payeeId, // cash recipient → FNB batch reads their bank
            buyerId: swap.cashPayerId, // cash payer
            orderReference: `${payeeRef ?? `SWAP-${swapId}`}-ST`,
            listingPrice: 0,
            commissionZar: 0,
            processingFee: 0,
            passFeeToBuyer: false,
            buyerTotal: 0,
            sellerPayout: swap.cashAmount, // the held cash → payee
            paymentStatus: PaymentStatus.RELEASED,
            releasedAt: now,
          },
        });
        settlementTxId = created.id;
        await txc.swap.update({
          where: { id: swapId },
          data: { settlementTxId },
        });
      }
      this.logger.log(
        `Swap ${swapId} → COMPLETED${settlementTxId ? ` (settlement tx ${settlementTxId} pays cash recipient)` : ' (no cash top-up)'}`,
      );
      return { released: true, settlementTxId };
    });
  }

  // Cron — AWAITING_VERIFICATION swaps past the window with no dispute raised
  // → release + COMPLETED. (DISPUTED swaps drop out of the filter and wait for
  // an admin.)
  async sweepSwapVerification() {
    if (PAYMENT_MODE !== 'manual') return;
    const now = new Date();
    // Self-heal: a swap must never sit in AWAITING_VERIFICATION without a
    // deadline (the rollup always stamps one + the S5 migration backfilled any
    // pre-existing rows). If one ever does — a future regression — give it a
    // fresh window so the cash can never strand, rather than releasing it
    // immediately (which would skip the dispute window).
    await this.prisma.swap.updateMany({
      where: {
        status: SwapStatus.AWAITING_VERIFICATION,
        cashReleasedAt: null,
        verificationDeadlineAt: null,
      },
      data: {
        verificationDeadlineAt: new Date(
          now.getTime() + VERIFICATION_WINDOW_HOURS * 3_600_000,
        ),
      },
    });
    const due = await this.prisma.swap.findMany({
      where: {
        status: SwapStatus.AWAITING_VERIFICATION,
        cashReleasedAt: null,
        verificationDeadlineAt: { not: null, lt: now },
      },
      select: { id: true },
      take: 50,
    });
    for (const s of due) {
      try {
        const res = await this.releaseSwap(s.id, [
          SwapStatus.AWAITING_VERIFICATION,
        ]);
        if (res.released) {
          this.logger.log(
            `Swap ${s.id} verification window elapsed → COMPLETED`,
          );
          void this.notifySwapCompleted(s.id);
        }
      } catch (err) {
        this.logger.warn(
          `swap verification sweep failed for ${s.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // A participant flags a problem with the item they received. Allowed from
  // IN_TRANSIT or AWAITING_VERIFICATION, only before the cash has moved
  // (cashReleasedAt:null) — so a recipient can stop the auto-release. Goes to
  // DISPUTED (admin-owned; funds stay held).
  async raiseSwapDispute(clerkId: string, swapId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 10) {
      throw new BadRequestException(
        'Please describe the problem (at least 10 characters).',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException();
    const swap = await this.prisma.swap.findUnique({
      where: { id: swapId },
      select: { initiatorId: true, ownerId: true },
    });
    if (!swap) throw new NotFoundException('Swap not found');
    if (user.id !== swap.initiatorId && user.id !== swap.ownerId) {
      throw new ForbiddenException('Access denied');
    }
    const claim = await this.prisma.swap.updateMany({
      where: {
        id: swapId,
        status: { in: [SwapStatus.IN_TRANSIT, SwapStatus.AWAITING_VERIFICATION] },
        cashReleasedAt: null,
      },
      data: {
        status: SwapStatus.DISPUTED,
        disputedAt: new Date(),
        disputeReason: trimmed.slice(0, 500),
        disputeRaisedById: user.id,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This swap can no longer be disputed.');
    }
    await this.prisma.adminAlert
      .create({
        data: {
          type: 'swap-dispute-raised',
          referenceId: swapId,
          context: `Swap ${swapId} disputed by user ${user.id}: ${trimmed.slice(0, 200)}`,
          urgent: true,
        },
      })
      .catch(() => undefined);
    void this.notifySwapDisputed(swapId);
    return { ok: true };
  }

  // ----------------------------------------------------------------
  // Admin dispute resolution (admin-owned swaps).
  // ----------------------------------------------------------------

  // Resolve in favour of completing the swap: release the cash to the
  // recipient + COMPLETED. Works from DISPUTED or AWAITING_VERIFICATION.
  async adminForceComplete(swapId: string) {
    const res = await this.releaseSwap(swapId, [
      SwapStatus.DISPUTED,
      SwapStatus.AWAITING_VERIFICATION,
    ]);
    if (!res.released) {
      throw new BadRequestException(
        'Swap is not in a completable state (already settled?).',
      );
    }
    void this.notifySwapCompleted(swapId);
    return { ok: true, settlementTxId: res.settlementTxId };
  }

  // Resolve by returning the cash to the payer (the swap went bad). The
  // physical goods are already delivered, so this only reverses the money: a
  // synthetic REFUNDED tx (→ FNB refund batch) returns the cash top-up to the
  // payer. cashReleasedAt is stamped (same money-moved guard) so it can't also
  // be force-completed. Status → CANCELLED.
  async adminUnwind(swapId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException('A reason is required to unwind a swap.');
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (txc) => {
      const claim = await txc.swap.updateMany({
        where: {
          id: swapId,
          status: { in: [SwapStatus.DISPUTED, SwapStatus.AWAITING_VERIFICATION] },
          cashReleasedAt: null,
        },
        data: {
          status: SwapStatus.CANCELLED,
          cancelledAt: now,
          cancelledReason: `admin-unwind: ${trimmed}`.slice(0, 500),
          cashReleasedAt: now,
        },
      });
      if (claim.count === 0) return { unwound: false, refunded: 0 };

      const swap = await txc.swap.findUnique({
        where: { id: swapId },
        select: {
          initiatorId: true,
          ownerId: true,
          cashPayerId: true,
          cashAmount: true,
          initiatorFundingRef: true,
          ownerFundingRef: true,
          transactions: {
            select: { sellerId: true, listingId: true, swapRole: true },
          },
        },
      });
      if (!swap) return { unwound: true, refunded: 0 };

      if (swap.cashAmount > 0 && swap.cashPayerId) {
        const payerId = swap.cashPayerId;
        const counterpartyId =
          payerId === swap.initiatorId ? swap.ownerId : swap.initiatorId;
        const realLegs = swap.transactions.filter((t) => t.swapRole != null);
        const payerLeg =
          realLegs.find((t) => t.sellerId === payerId) ?? realLegs[0];
        const payerRef =
          payerId === swap.initiatorId
            ? swap.initiatorFundingRef
            : swap.ownerFundingRef;
        await txc.transaction.create({
          data: {
            swapId,
            listingId: payerLeg.listingId,
            buyerId: payerId, // payer gets the cash back (FNB refund batch)
            sellerId: counterpartyId,
            orderReference: `${payerRef ?? `SWAP-${swapId}`}-UW`,
            listingPrice: 0,
            commissionZar: 0,
            processingFee: 0,
            passFeeToBuyer: false,
            buyerTotal: swap.cashAmount,
            sellerPayout: 0,
            refundedAmount: swap.cashAmount,
            paymentStatus: PaymentStatus.REFUNDED,
            lastRefundAt: now,
          },
        });
        return { unwound: true, refunded: swap.cashAmount };
      }
      return { unwound: true, refunded: 0 };
    });
    if (!result.unwound) {
      throw new BadRequestException('Swap is not in an unwindable state.');
    }
    this.logger.log(
      `Swap ${swapId} admin-unwound → CANCELLED${result.refunded > 0 ? ` (R${(result.refunded / 100).toFixed(2)} cash refunded to payer)` : ''}`,
    );
    void this.notifyFundingCancelled(swapId);
    return { ok: true, refunded: result.refunded };
  }

  // ----------------------------------------------------------------
  // Admin read views.
  // ----------------------------------------------------------------
  async adminListSwaps(status?: string) {
    const where: Prisma.SwapWhereInput = {};
    if (status && status !== 'ALL') where.status = status as SwapStatus;
    const swaps = await this.prisma.swap.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        status: true,
        cashAmount: true,
        cashPayerId: true,
        disputedAt: true,
        disputeReason: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        cancelledAt: true,
        initiator: { select: { id: true, username: true } },
        owner: { select: { id: true, username: true } },
      },
    });
    return swaps;
  }

  async adminGetSwap(id: string) {
    const swap = await this.prisma.swap.findUnique({
      where: { id },
      include: {
        initiator: {
          select: { id: true, username: true, email: true, phone: true },
        },
        owner: {
          select: { id: true, username: true, email: true, phone: true },
        },
        transactions: {
          select: {
            id: true,
            swapRole: true,
            sellerId: true,
            buyerId: true,
            paymentStatus: true,
            shippingStatus: true,
            shippingMethod: true,
            trackingReference: true,
            carrierShipmentId: true,
            shipmentBookedAt: true,
            deliveredAt: true,
            shippingCost: true,
            buyerTotal: true,
            sellerPayout: true,
            refundedAmount: true,
            orderReference: true,
            swapProofStatus: true,
            swapProofPhotoUrl: true,
            swapProofScore: true,
            swapProofCode: true,
            listing: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!swap) throw new NotFoundException('Swap not found');
    return swap;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  private async loadForParty(clerkId: string, swapId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException();
    const swap = await this.prisma.swap.findUnique({
      where: { id: swapId },
      include: {
        transactions: {
          select: {
            id: true,
            swapRole: true,
            listingId: true,
            deliveryAddress: true,
            listing: { select: { isFirearm: true } },
          },
        },
      },
    });
    if (!swap) throw new NotFoundException('Swap not found');
    const side: Side | null =
      swap.initiatorId === user.id
        ? 'INITIATOR'
        : swap.ownerId === user.id
          ? 'OWNER'
          : null;
    if (!side) throw new ForbiddenException('Access denied');
    return { swap, side };
  }

  private async notifyFundingReady(swapId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, owner: true },
      });
      if (!swap) return;
      await this.notifications.swapFundingReady({
        email: swap.initiator.email,
        name: swap.initiator.firstName ?? 'there',
        phone: swap.initiator.phone,
        amountCents: swap.initiatorFundingAmount,
        reference: swap.initiatorFundingRef ?? '',
        swapId,
      });
      await this.notifications.swapFundingReady({
        email: swap.owner.email,
        name: swap.owner.firstName ?? 'there',
        phone: swap.owner.phone,
        amountCents: swap.ownerFundingAmount,
        reference: swap.ownerFundingRef ?? '',
        swapId,
      });
    } catch (err) {
      this.logger.error(`notifyFundingReady failed: ${(err as Error).message}`);
    }
  }

  private async notifyLocked(swapId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, owner: true },
      });
      if (!swap) return;
      for (const u of [swap.initiator, swap.owner]) {
        await this.notifications.swapLocked({
          email: u.email,
          name: u.firstName ?? 'there',
          phone: u.phone,
          swapId,
        });
      }
    } catch (err) {
      this.logger.error(`notifyLocked failed: ${(err as Error).message}`);
    }
  }

  private async notifyFundingCancelled(swapId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, owner: true },
      });
      if (!swap) return;
      for (const u of [swap.initiator, swap.owner]) {
        await this.notifications.swapFundingCancelled({
          email: u.email,
          name: u.firstName ?? 'there',
          swapId,
        });
      }
    } catch (err) {
      this.logger.error(`notifyFundingCancelled failed: ${(err as Error).message}`);
    }
  }

  private async notifySwapCompleted(swapId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, owner: true },
      });
      if (!swap) return;
      const payeeId =
        swap.cashAmount > 0 && swap.cashPayerId
          ? swap.cashPayerId === swap.initiatorId
            ? swap.ownerId
            : swap.initiatorId
          : null;
      for (const u of [swap.initiator, swap.owner]) {
        await this.notifications.swapCompleted({
          email: u.email,
          name: u.firstName ?? 'there',
          phone: u.phone,
          swapId,
          cashPayoutCents: u.id === payeeId ? swap.cashAmount : 0,
        });
      }
    } catch (err) {
      this.logger.error(`notifySwapCompleted failed: ${(err as Error).message}`);
    }
  }

  private async notifySwapDisputed(swapId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, owner: true },
      });
      if (!swap) return;
      for (const u of [swap.initiator, swap.owner]) {
        await this.notifications.swapDisputed({
          email: u.email,
          name: u.firstName ?? 'there',
          swapId,
        });
      }
    } catch (err) {
      this.logger.error(`notifySwapDisputed failed: ${(err as Error).message}`);
    }
  }
}
