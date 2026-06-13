import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StitchService } from './stitch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingService } from '../shipping/tracking.service';

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

        // Status already flipped to REFUNDED by the claim above. Now
        // reactivate the listing + strike the seller atomically.
        await this.prisma.$transaction([
          this.prisma.listing.update({
            where: { id: tx.listingId },
            data: { status: 'ACTIVE', soldAt: null },
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
}
