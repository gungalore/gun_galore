import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StitchService } from './stitch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingService } from '../shipping/tracking.service';
import { ShippingService } from '../shipping/shipping.service';
import { PAYMENT_MODE } from './transactions.service';
import { reversalListingData } from './inventory';

// Two thresholds for courier-shipped orders (PUDO / TCG only —
// PRIVATE_ARRANGE has no dispatch step, DEALER_TRANSFER routes
// through the dealer and not the SLA). Both measured from
// acceptedAt (TOK-7 Phase 2 change — was paidAt before).
//
// The dispatch window opens the moment the seller accepts; legacy
// (pre-Phase-1) transactions got `acceptedAt = paidAt` backfilled at
// the Phase 1 deploy so the clock still starts cleanly for them too.
const NUDGE_BEFORE_REFUND_HOURS = 24;
const DISPATCH_WINDOW_DAYS = 5;

@Injectable()
export class DispatchSlaService {
  private readonly logger = new Logger(DispatchSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stitch: StitchService,
    private readonly notifications: NotificationsService,
    private readonly tracking: TrackingService,
    // FLOW-F1 — the auto-refund must also cancel the carrier shipment GG
    // booked at seller-accept, or the paid waybill stays live (courier
    // credits burned + a parcel that could still be dropped/collected on a
    // refunded order). Same module as TransactionsService, which already
    // injects ShippingService.
    private readonly shipping: ShippingService,
  ) {}

  // ------------------------------------------------------------------
  // Pre-deadline nudge — finds accepted-but-not-yet-dispatched courier
  // orders whose dispatch deadline is < 24h away and sends a one-shot
  // reminder (SMS + email). Idempotent via dispatchNudgedAt — once
  // stamped, the cron skips the row.
  //
  // TOK-7 Phase 2: gates on acceptedAt (sellers who haven't accepted
  // get the SEPARATE accept-escalation cron, not this dispatch nudge —
  // they shouldn't get pinged about dispatching something they haven't
  // committed to fulfilling).
  // ------------------------------------------------------------------
  async nudgeStale(): Promise<{ scanned: number; nudged: number }> {
    const nudgeCutoff = new Date(
      Date.now() + NUDGE_BEFORE_REFUND_HOURS * 60 * 60 * 1000,
    );

    const stale = await this.prisma.transaction.findMany({
      where: {
        acceptedAt: { not: null },
        dispatchDeadlineAt: { lte: nudgeCutoff },
        dispatchedAt: null,
        rejectedAt: null,
        dispatchNudgedAt: null,
        paymentStatus: 'HELD',
        shippingMethod: { in: ['PUDO', 'TCG'] },
      },
      include: {
        listing: true,
        seller: true,
        buyer: true,
      },
      take: 100,
    });

    let nudged = 0;
    for (const tx of stale) {
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { dispatchNudgedAt: new Date() },
        });
        await this.notifications.dispatchNudgeSeller({
          sellerEmail: tx.seller.email,
          sellerPhone: tx.seller.phone,
          sellerName:
            [tx.seller.firstName, tx.seller.lastName]
              .filter(Boolean)
              .join(' ') || 'Seller',
          listingTitle: tx.listing.title,
          transactionId: tx.id,
          // hoursElapsed = how long since they accepted (existing field
          // in the notification's signature; preserved for copy parity).
          hoursElapsed: tx.acceptedAt
            ? Math.floor(
                (Date.now() - tx.acceptedAt.getTime()) / 3_600_000,
              )
            : 0,
          autoRefundDays: DISPATCH_WINDOW_DAYS,
        });
        nudged++;
      } catch (err) {
        this.logger.warn(
          `dispatch nudge failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: stale.length, nudged };
  }

  // ------------------------------------------------------------------
  // 7d auto-refund — courier orders that are still HELD and never
  // dispatched. We Peach-refund, mark the transaction REFUNDED,
  // re-activate the listing, strike the seller, and notify both
  // parties. The seller's third strike is an AdminAlert for manual
  // suspension review (not auto-banned — that's the operator's call).
  // ------------------------------------------------------------------
  async autoRefundStale(): Promise<{ scanned: number; refunded: number }> {
    const now = new Date();

    const stale = await this.prisma.transaction.findMany({
      where: {
        // TOK-7 Phase 2: gates on the explicit dispatchDeadlineAt
        // (= acceptedAt + 5d) instead of `paidAt + 7d`. Sellers who
        // never accepted are handled by escalateStaleAccepts on a
        // separate path — they don't get auto-refunded by this cron.
        acceptedAt: { not: null },
        dispatchDeadlineAt: { lte: now },
        dispatchedAt: null,
        rejectedAt: null,
        paymentStatus: 'HELD',
        shippingMethod: { in: ['PUDO', 'TCG'] },
      },
      include: { listing: true, seller: true, buyer: true },
      take: 50,
    });

    let refunded = 0;
    for (const tx of stale) {
      try {
        // ─── Atomic claim BEFORE touching the gateway ─────────────────
        // Flip HELD→REFUNDED guarded on { paymentStatus:'HELD',
        // dispatchedAt:null } so a seller dispatching at the same instant
        // (or an overlapping cron run) can't both refund the buyer AND
        // let the seller ship. count===0 → another path won; skip. On
        // gateway failure we roll the claim back to HELD for admin review.
        const claim = await this.prisma.transaction.updateMany({
          where: { id: tx.id, paymentStatus: 'HELD', dispatchedAt: null },
          data: { paymentStatus: 'REFUNDED', releasedAt: null },
        });
        if (claim.count === 0) {
          this.logger.log(
            `Auto-refund cron: ${tx.id} no longer HELD/undispatched — skipping (seller dispatched or already handled)`,
          );
          continue;
        }

        const r = tx.peachPaymentId
          ? await this.stitch.refundPayment(tx.peachPaymentId, tx.buyerTotal)
          : { success: true, resultCode: 'NO_PAYMENT_ID' };

        if (!r.success) {
          this.logger.warn(
            `Auto-refund cron: Stitch refund failed for ${tx.id} (${r.resultCode}) — rolling back to HELD for admin review`,
          );
          // Roll the claim back so the row returns to HELD for a retry.
          await this.prisma.transaction
            .update({
              where: { id: tx.id },
              data: { paymentStatus: 'HELD' },
            })
            .catch(() => undefined);
          // Raise admin alert so a human can intervene + manually
          // refund / contact the seller.
          await this.prisma.adminAlert.create({
            data: {
              type: 'DISPATCH_SLA_REFUND_FAILED',
              referenceId: tx.id,
              urgent: true,
              context: `Stitch refund failed: ${r.resultCode} ${r.message ?? ''}`,
            },
          });
          continue;
        }

        // FLOW-F1 — cancel the carrier shipment booked at seller-accept
        // (waybill + PIN already issued). cancelForTransaction is fail-safe:
        // cancels while the parcel hasn't entered the network, alerts an
        // admin instead once it's COLLECTED+, and never throws — so a
        // carrier hiccup can't break the refund that already claimed above.
        await this.shipping.cancelForTransaction(tx.id).catch(() => undefined);

        // Status already flipped to REFUNDED by the claim above. Now
        // reactivate the listing + strike the seller atomically. Phase 8a:
        // a tracked listing restocks the units (legacy → plain ACTIVE).
        const fresh = await this.prisma.transaction.findUnique({
          where: { id: tx.id },
          select: {
            quantity: true,
            listing: { select: { trackInventory: true, listingType: true } },
          },
        });
        await this.prisma.$transaction([
          this.prisma.listing.update({
            where: { id: tx.listingId },
            // Ended auctions land EXPIRED, never back to ACTIVE (zombie fix).
            data: reversalListingData(
              fresh?.listing?.trackInventory ?? false,
              fresh?.quantity ?? 1,
              fresh?.listing?.listingType,
            ),
          }),
          this.prisma.user.update({
            where: { id: tx.sellerId },
            data: {
              dispatchStrikes: { increment: 1 },
              lastStrikeAt: new Date(),
            },
          }),
        ]);

        const sellerAfter = await this.prisma.user.findUnique({
          where: { id: tx.sellerId },
          select: { dispatchStrikes: true },
        });
        if ((sellerAfter?.dispatchStrikes ?? 0) >= 3) {
          await this.prisma.adminAlert.create({
            data: {
              type: 'SELLER_DISPATCH_STRIKES_THRESHOLD',
              referenceId: tx.sellerId,
              urgent: true,
              context: `Seller hit ${sellerAfter?.dispatchStrikes} dispatch strikes — review for suspension`,
            },
          });
        }

        void this.tracking.recordInternal(tx.id, 'AUTO_REFUNDED_NO_DISPATCH', {
          message: `Auto-refunded after ${DISPATCH_WINDOW_DAYS} days without dispatch`,
        });

        await this.notifications.orderAutoRefunded({
          listingTitle: tx.listing.title,
          transactionId: tx.id,
          buyerTotal: tx.buyerTotal,
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
          // FLOW-F2 — rail-aware copy: EFT refund via the FNB batch, and
          // flag when it can't be paid until the buyer adds bank details.
          manualEft: PAYMENT_MODE === 'manual',
          needsBankDetails:
            PAYMENT_MODE === 'manual' &&
            !(
              tx.buyer.bankAccountHolder &&
              tx.buyer.bankAccountNumber &&
              tx.buyer.bankBranchCode
            ),
        });

        refunded++;
        this.logger.log(
          `Auto-refunded transaction ${tx.id} — seller ${tx.sellerId} struck (${sellerAfter?.dispatchStrikes})`,
        );
      } catch (err) {
        this.logger.error(
          `auto-refund failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: stale.length, refunded };
  }

  // ------------------------------------------------------------------
  // P5.3 — stuck HELD funds alert (operator decision: NO auto-release).
  // A courier order the carrier marked DELIVERED > STUCK_AFTER_HOURS ago,
  // but the buyer never tapped "confirm receipt", so funds sit HELD. Raise
  // a one-shot AdminAlert (deep-linked to the transaction dossier) so the
  // admin can review + MANUALLY release. Idempotent via
  // adminAlertedForStuckFundsAt. Excludes swap legs + firearm dealer-transfer
  // that isn't APPROVED (unreleaseable anyway). Money never moves here.
  // ------------------------------------------------------------------
  async alertStuckHeldFunds(): Promise<{ scanned: number; alerted: number }> {
    const STUCK_AFTER_HOURS = 72;
    const cutoff = new Date(Date.now() - STUCK_AFTER_HOURS * 60 * 60 * 1000);

    const stuck = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'HELD',
        paidAt: { not: null },
        confirmedDeliveryAt: null,
        deliveredAt: { not: null, lte: cutoff },
        adminAlertedForStuckFundsAt: null,
        swapId: null,
        shippingMethod: { in: ['PUDO', 'TCG'] },
      },
      select: {
        id: true,
        orderReference: true,
        buyerTotal: true,
        sellerPayout: true,
        deliveredAt: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true } },
        seller: { select: { username: true } },
      },
      take: 200,
    });

    let alerted = 0;
    for (const tx of stuck) {
      try {
        const hrs = tx.deliveredAt
          ? Math.floor((Date.now() - tx.deliveredAt.getTime()) / 3_600_000)
          : STUCK_AFTER_HOURS;
        const rand = (c: number) => 'R' + (c / 100).toFixed(2);
        // Create the alert AND stamp the idempotency guard in ONE atomic
        // transaction: both commit or neither. Stamping first (separately)
        // risked a lost alert forever — if adminAlert.create then failed, the
        // guard was already written so the next hourly run would skip this row
        // and the only proactive stuck-funds signal would be gone. Doing both
        // together means a create failure rolls back the stamp → the next run
        // simply retries, with no duplicate alert on success.
        await this.prisma.$transaction([
          this.prisma.adminAlert.create({
            data: {
              type: 'STUCK_HELD_FUNDS_BUYER_UNCONFIRMED',
              referenceId: tx.id,
              urgent: false,
              context:
                `Order ${tx.orderReference ?? tx.id} (${tx.listing?.title ?? 'listing'}) ` +
                `was delivered ${hrs}h ago but buyer @${tx.buyer?.username ?? '—'} never ` +
                `confirmed receipt. ${rand(tx.buyerTotal)} still HELD; seller ` +
                `@${tx.seller?.username ?? '—'} owed ${rand(tx.sellerPayout)}. ` +
                `Review + release manually from the transaction dossier.`,
            },
          }),
          this.prisma.transaction.update({
            where: { id: tx.id },
            data: { adminAlertedForStuckFundsAt: new Date() },
          }),
        ]);
        alerted++;
      } catch (err) {
        this.logger.warn(
          `stuck-funds alert failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    if (alerted > 0) {
      this.logger.log(`Stuck-held-funds: alerted admin on ${alerted} order(s)`);
    }
    return { scanned: stuck.length, alerted };
  }

  // ------------------------------------------------------------------
  // FLOW-F4 (H12/H15/H16) — DEALER_TRANSFER stall backstop. A firearm sale
  // routes through a licensed dealer, so it is deliberately EXCLUDED from the
  // courier nudge/auto-refund/stuck-funds sweeps above (all PUDO/TCG-only).
  // That left an accepted-but-never-transferred firearm order with ZERO
  // backstop: money HELD indefinitely, no seller reminder, no admin signal,
  // and — until the raiseDispute fix — no buyer escape either.
  //
  // Two-stage, both idempotent, NO auto-refund (operator policy: dealer
  // logistics run long + firearm transfers need human judgment, so a human
  // resolves — refund or chase — from the dossier):
  //   1. Past dispatchDeadlineAt (= acceptedAt + 5d) → one-shot seller nudge
  //      to complete the dealer hand-off (guarded by dispatchNudgedAt, which
  //      the courier nudge never sets on a DT row).
  //   2. Past dispatchDeadlineAt + DT_STALL_ALERT_GRACE_HOURS → one-shot
  //      urgent AdminAlert (guarded by adminAlertedForDtStallAt), created
  //      atomically with its stamp like alertStuckHeldFunds.
  // Scope: accepted, HELD, DEALER_TRANSFER, not a swap leg, dealer-verify not
  // yet APPROVED (an APPROVED tx has already released, and REJECTED/pending
  // still need the transfer completed or resolved).
  // ------------------------------------------------------------------
  async sweepStalledDealerTransfers(): Promise<{
    scanned: number;
    nudged: number;
    alerted: number;
  }> {
    const DT_STALL_ALERT_GRACE_HOURS = 48;
    const now = new Date();
    const alertCutoff = new Date(
      now.getTime() - DT_STALL_ALERT_GRACE_HOURS * 60 * 60 * 1000,
    );

    const stalled = await this.prisma.transaction.findMany({
      where: {
        acceptedAt: { not: null },
        dispatchDeadlineAt: { lte: now },
        dispatchedAt: null,
        rejectedAt: null,
        paymentStatus: 'HELD',
        shippingMethod: 'DEALER_TRANSFER',
        swapId: null,
        // Not yet released via an APPROVED dealer verification. Explicit OR so
        // the NULL case — seller never even started the transfer, the single
        // most common stall — is unambiguously included alongside PENDING_*
        // and REJECTED. (Prisma's `not` is null-inclusive, but on a firearm
        // money-safety path we spell it out rather than rely on that.)
        OR: [
          { dealerVerificationStatus: null },
          { dealerVerificationStatus: { not: 'APPROVED' } },
        ],
      },
      include: { listing: { select: { title: true } }, seller: true },
      take: 100,
    });

    let nudged = 0;
    let alerted = 0;
    for (const tx of stalled) {
      const daysElapsed = tx.acceptedAt
        ? Math.max(
            1,
            Math.floor((now.getTime() - tx.acceptedAt.getTime()) / 86_400_000),
          )
        : 5;

      // Stage 1 — one-shot seller nudge.
      if (!tx.dispatchNudgedAt) {
        try {
          await this.prisma.transaction.update({
            where: { id: tx.id },
            data: { dispatchNudgedAt: now },
          });
          await this.notifications.dealerTransferStallNudgeSeller({
            sellerEmail: tx.seller.email,
            sellerName:
              [tx.seller.firstName, tx.seller.lastName]
                .filter(Boolean)
                .join(' ') || 'Seller',
            sellerPhone: tx.seller.phone,
            listingTitle: tx.listing.title,
            transactionId: tx.id,
            daysElapsed,
          });
          nudged++;
        } catch (err) {
          this.logger.warn(
            `DT stall nudge failed for ${tx.id}: ${(err as Error).message}`,
          );
        }
      }

      // Stage 2 — one-shot urgent admin alert once the grace window lapses.
      if (
        !tx.adminAlertedForDtStallAt &&
        tx.dispatchDeadlineAt &&
        tx.dispatchDeadlineAt <= alertCutoff
      ) {
        try {
          await this.prisma.$transaction([
            this.prisma.adminAlert.create({
              data: {
                type: 'DEALER_TRANSFER_STALLED',
                referenceId: tx.id,
                urgent: true,
                context:
                  `Firearm order ${tx.id.slice(-8).toUpperCase()} (${tx.listing.title}) — ` +
                  `seller @${tx.seller.username ?? '—'} accepted ${daysElapsed}d ago but the ` +
                  `dealer transfer is still incomplete (verification ${tx.dealerVerificationStatus ?? 'not started'}). ` +
                  `Buyer's payment is HELD. Chase the seller or refund from the dossier — no auto-refund on this path.`,
              },
            }),
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: { adminAlertedForDtStallAt: now },
            }),
          ]);
          alerted++;
        } catch (err) {
          this.logger.warn(
            `DT stall alert failed for ${tx.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    if (nudged > 0 || alerted > 0) {
      this.logger.log(
        `DT stall sweep: nudged ${nudged} seller(s), alerted admin on ${alerted} order(s)`,
      );
    }
    return { scanned: stalled.length, nudged, alerted };
  }

  // ------------------------------------------------------------------
  // FLOW-F6 (H6) — COLLECTION stall backstop. An in-person pickup has no
  // dispatch step, so it is EXCLUDED from every courier sweep (PUDO/TCG-only)
  // and the DEALER_TRANSFER sweep. That left a paid + accepted + never-
  // collected order with ZERO backstop: money HELD indefinitely, no buyer
  // reminder, no admin signal — and it only polluted the mislabelled
  // "dispatch SLA at risk" counts.
  //
  // Two-stage, both idempotent, NO auto-refund (operator policy — collection
  // logistics are between the two members; a human resolves refund-or-chase
  // from the dossier):
  //   1. Past dispatchDeadlineAt (= acceptedAt + 5d) → one-shot buyer
  //      "please confirm your collection" nudge (guarded by
  //      collectionConfirmNudgedAt).
  //   2. Past dispatchDeadlineAt + COLLECTION_STALL_ALERT_GRACE_HOURS →
  //      one-shot urgent AdminAlert STUCK_HELD_FUNDS_COLLECTION_UNCONFIRMED
  //      (guarded by adminAlertedForCollectionStallAt), created atomically
  //      with its stamp like alertStuckHeldFunds.
  // Scope: accepted, HELD, paid, COLLECTION, not a swap leg, not confirmed,
  // not rejected.
  // ------------------------------------------------------------------
  async sweepStalledCollection(): Promise<{
    scanned: number;
    nudged: number;
    alerted: number;
  }> {
    const COLLECTION_STALL_ALERT_GRACE_HOURS = 48;
    const now = new Date();
    const alertCutoff = new Date(
      now.getTime() - COLLECTION_STALL_ALERT_GRACE_HOURS * 60 * 60 * 1000,
    );

    const stalled = await this.prisma.transaction.findMany({
      where: {
        acceptedAt: { not: null },
        dispatchDeadlineAt: { lte: now },
        paidAt: { not: null },
        rejectedAt: null,
        confirmedDeliveryAt: null,
        paymentStatus: 'HELD',
        shippingMethod: 'COLLECTION',
        swapId: null,
      },
      include: { listing: { select: { title: true } }, buyer: true, seller: true },
      take: 100,
    });

    let nudged = 0;
    let alerted = 0;
    for (const tx of stalled) {
      const daysElapsed = tx.acceptedAt
        ? Math.max(
            1,
            Math.floor((now.getTime() - tx.acceptedAt.getTime()) / 86_400_000),
          )
        : 5;

      // Stage 1 — one-shot buyer collection-confirm nudge.
      if (!tx.collectionConfirmNudgedAt) {
        try {
          await this.prisma.transaction.update({
            where: { id: tx.id },
            data: { collectionConfirmNudgedAt: now },
          });
          await this.notifications.collectionConfirmNudgeBuyer({
            buyerEmail: tx.buyer.email,
            buyerName:
              [tx.buyer.firstName, tx.buyer.lastName]
                .filter(Boolean)
                .join(' ') || 'Buyer',
            buyerPhone: tx.buyer.phone,
            listingTitle: tx.listing.title,
            transactionId: tx.id,
            daysElapsed,
          });
          nudged++;
        } catch (err) {
          this.logger.warn(
            `collection stall nudge failed for ${tx.id}: ${(err as Error).message}`,
          );
        }
      }

      // Stage 2 — one-shot urgent admin alert once the grace window lapses.
      if (
        !tx.adminAlertedForCollectionStallAt &&
        tx.dispatchDeadlineAt &&
        tx.dispatchDeadlineAt <= alertCutoff
      ) {
        try {
          await this.prisma.$transaction([
            this.prisma.adminAlert.create({
              data: {
                type: 'STUCK_HELD_FUNDS_COLLECTION_UNCONFIRMED',
                referenceId: tx.id,
                urgent: true,
                context:
                  `Collection order ${tx.orderReference ?? tx.id.slice(-8).toUpperCase()} (${tx.listing.title}) — ` +
                  `buyer @${tx.buyer.username ?? '—'} paid + seller @${tx.seller.username ?? '—'} accepted ${daysElapsed}d ago but the buyer ` +
                  `never confirmed collection. Payment is HELD. Chase the buyer/seller or refund from the dossier — no auto-refund on this path.`,
              },
            }),
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: { adminAlertedForCollectionStallAt: now },
            }),
          ]);
          alerted++;
        } catch (err) {
          this.logger.warn(
            `collection stall alert failed for ${tx.id}: ${(err as Error).message}`,
          );
        }
      }
    }
    if (nudged > 0 || alerted > 0) {
      this.logger.log(
        `Collection stall sweep: nudged ${nudged} buyer(s), alerted admin on ${alerted} order(s)`,
      );
    }
    return { scanned: stalled.length, nudged, alerted };
  }
}
