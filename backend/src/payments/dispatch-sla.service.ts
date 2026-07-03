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
}
