import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  SwapStatus,
  SwapRole,
  ListingStatus,
  PaymentStatus,
  ShippingMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingService } from '../shipping/shipping.service';
import { FeeCalculator } from '../payments/fee.calculator';
import { PAYMENT_MODE } from '../payments/transactions.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SwapDeliveryDto } from './dto/swap-delivery.dto';

// How long both parties have to fund after setup. Two people must coordinate
// an EFT each, so a few days is reasonable (vs the 1h single-buyer freeze).
const FUNDING_WINDOW_HOURS = 72;

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

    // Both addresses in? Quote + set up funding.
    const fresh = await this.prisma.swap.findUnique({
      where: { id: swapId },
      select: {
        transactions: { select: { swapRole: true, deliveryAddress: true } },
      },
    });
    const bothIn =
      !!fresh &&
      fresh.transactions.length === 2 &&
      fresh.transactions.every((t) => t.deliveryAddress != null);
    if (bothIn) {
      await this.ensureFundingSetUp(swapId);
    }
    return this.getFundingState(clerkId, swapId);
  }

  // ----------------------------------------------------------------
  // Quote both legs + compute per-party amounts + allocate refs + set the
  // deadline. Claim-guarded (fundingSetUpAt) so it runs exactly once; rolls
  // the claim back if a live carrier quote fails so it can be retried.
  // ----------------------------------------------------------------
  async ensureFundingSetUp(swapId: string) {
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
            select: { id: true, swapRole: true, listingId: true, deliveryAddress: true },
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
      if (!initiatorGives.deliveryAddress || !ownerGives.deliveryAddress) {
        throw new BadRequestException('Both delivery addresses are required');
      }

      // Each party funds the leg they SEND. The recipient's address (stored on
      // that leg) is the quote destination.
      const initiatorQuote = await this.quoteLeg(
        initiatorGives.listingId,
        initiatorGives.deliveryAddress,
      );
      const ownerQuote = await this.quoteLeg(
        ownerGives.listingId,
        ownerGives.deliveryAddress,
      );

      const initiatorCash =
        swap.cashPayerId === swap.initiatorId ? swap.cashAmount : 0;
      const ownerCash = swap.cashPayerId === swap.ownerId ? swap.cashAmount : 0;

      const initiatorBd = this.fees.breakdownSwapLeg(
        initiatorQuote.priceCents,
        initiatorCash,
        false,
        'manual',
      );
      const ownerBd = this.fees.breakdownSwapLeg(
        ownerQuote.priceCents,
        ownerCash,
        false,
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
            shippingMethod: ShippingMethod.TCG,
          },
        }),
        this.prisma.transaction.update({
          where: { id: ownerGives.id },
          data: {
            shippingCost: ownerQuote.priceCents,
            shippingServiceCode: ownerQuote.serviceCode,
            shippingMethod: ShippingMethod.TCG,
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

    const swap = await this.prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap) return;

    if (swap.initiatorVerifiedAt && swap.ownerVerifiedAt) {
      const lock = await this.prisma.swap.updateMany({
        where: { id: swapId, status: SwapStatus.AWAITING_FUNDING },
        data: { status: SwapStatus.LOCKED, lockedAt: now },
      });
      if (lock.count > 0) {
        this.logger.log(`Swap ${swapId} fully funded → LOCKED`);
        void this.notifyLocked(swapId);
      }
    }
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
    };
  }

  // All of the caller's in-flight swaps — drives the /my/swaps page.
  async getMySwaps(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return [];
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
            swapRole: true,
            listing: {
              select: {
                id: true,
                title: true,
                images: { where: { isPrimary: true }, take: 1, select: { url: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return swaps.map((s) => {
      const mine = s.initiatorId === user.id;
      const myGiveRole = mine ? SwapRole.INITIATOR_GIVES : SwapRole.OWNER_GIVES;
      const myGetRole = mine ? SwapRole.OWNER_GIVES : SwapRole.INITIATOR_GIVES;
      const give = s.transactions.find((t) => t.swapRole === myGiveRole)?.listing;
      const get = s.transactions.find((t) => t.swapRole === myGetRole)?.listing;
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
        give: give
          ? { title: give.title, imageUrl: give.images[0]?.url ?? null }
          : null,
        get: get
          ? { title: get.title, imageUrl: get.images[0]?.url ?? null }
          : null,
      };
    });
  }

  // ----------------------------------------------------------------
  // Cron — funding deadline lapsed unfunded → cancel + restock + reimburse
  // any side that DID pay (synthetic REFUNDED tx → FNB refund batch).
  // ----------------------------------------------------------------
  async sweepExpiredFunding() {
    if (PAYMENT_MODE !== 'manual') return;
    const now = new Date();
    const stale = await this.prisma.swap.findMany({
      where: {
        status: SwapStatus.AWAITING_FUNDING,
        fundingSetUpAt: { not: null },
        cashPayByAt: { not: null, lt: now },
        // not yet fully funded (if both verified it would be LOCKED already)
        OR: [{ initiatorVerifiedAt: null }, { ownerVerifiedAt: null }],
      },
      include: {
        transactions: { select: { id: true, listingId: true } },
      },
      take: 50,
    });

    for (const swap of stale) {
      try {
        // Atomic claim: AWAITING_FUNDING → CANCELLED. A late confirm that
        // locked the swap in the gap makes this count=0 and we skip.
        const claim = await this.prisma.swap.updateMany({
          where: { id: swap.id, status: SwapStatus.AWAITING_FUNDING },
          data: {
            status: SwapStatus.CANCELLED,
            cancelledAt: now,
            cancelledReason: 'funding-not-completed',
          },
        });
        if (claim.count === 0) continue;

        // Release both reserved listings.
        await this.prisma.listing.updateMany({
          where: {
            id: { in: swap.transactions.map((t) => t.listingId) },
            status: ListingStatus.PAYMENT_PENDING,
          },
          data: { status: ListingStatus.ACTIVE },
        });

        // Reimburse whichever side funded (at most one — both → LOCKED).
        if (swap.initiatorVerifiedAt && !swap.initiatorRefundedAt) {
          await this.createFundingRefund(swap.id, 'INITIATOR');
        }
        if (swap.ownerVerifiedAt && !swap.ownerRefundedAt) {
          await this.createFundingRefund(swap.id, 'OWNER');
        }

        this.logger.log(
          `Swap ${swap.id} funding lapsed → CANCELLED; listings released`,
        );
        void this.notifyFundingCancelled(swap.id);
      } catch (err) {
        this.logger.warn(
          `swap funding sweep failed for ${swap.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // Create a synthetic REFUNDED Transaction so the FNB refund batch pays the
  // funded party back in full. swapId is set, so the orphan-reclaim sweep
  // (which requires swapId:null) never touches it.
  private async createFundingRefund(swapId: string, side: Side) {
    const swap = await this.prisma.swap.findUnique({
      where: { id: swapId },
      include: { transactions: { select: { id: true, swapRole: true, listingId: true } } },
    });
    if (!swap) return;

    const mine = side === 'INITIATOR';
    const amount = mine ? swap.initiatorFundingAmount : swap.ownerFundingAmount;
    const ref = mine ? swap.initiatorFundingRef : swap.ownerFundingRef;
    const refundedUserId = mine ? swap.initiatorId : swap.ownerId;
    const counterpartyId = mine ? swap.ownerId : swap.initiatorId;
    if (amount <= 0) return;
    // Use the leg this party SENT for the listing FK (bookkeeping only).
    const sentRole = mine ? SwapRole.INITIATOR_GIVES : SwapRole.OWNER_GIVES;
    const sentLeg = swap.transactions.find((t) => t.swapRole === sentRole);
    if (!sentLeg) return;

    // Idempotent guard — only create the refund once per side.
    const guard = mine
      ? await this.prisma.swap.updateMany({
          where: { id: swapId, initiatorRefundedAt: null },
          data: { initiatorRefundedAt: new Date() },
        })
      : await this.prisma.swap.updateMany({
          where: { id: swapId, ownerRefundedAt: null },
          data: { ownerRefundedAt: new Date() },
        });
    if (guard.count === 0) return;

    await this.prisma.transaction.create({
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
          select: { id: true, swapRole: true, listingId: true, deliveryAddress: true },
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
}
