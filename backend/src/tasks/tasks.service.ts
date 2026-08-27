import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
import { KycService } from '../kyc/kyc.service';
import { TrackingService } from '../shipping/tracking.service';
import { ShippingService } from '../shipping/shipping.service';
import { DispatchSlaService } from '../payments/dispatch-sla.service';
import { TransactionsService } from '../payments/transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeOrderRollupStatus } from '../orders/order-math';
import {
  AdminCreditsService,
  DEFAULT_THRESHOLDS,
} from '../admin/admin-credits.service';
import { AdminHealthService } from '../admin/admin-health.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { decideOpsAlert } from './ops-alert-decision';
import { PushService } from '../push/push.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { SavedSearchesService } from '../saved-searches/saved-searches.service';
import { DealsService } from '../deals/deals.service';
import { RatingsService } from '../ratings/ratings.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { WishlistAlertsService } from '../wishlist-alerts/wishlist-alerts.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationCategory } from '@prisma/client';

// Threshold-alert dedup window. Once we've fired an alert at any
// severity for a given service, we won't fire ANOTHER alert at the
// same severity for that service until this window elapses. Stops
// the 15-min cron from spamming the operator while the balance
// hovers just under the line.
// A credit alert is EDGE-TRIGGERED: it fires when the balance crosses the
// threshold, not repeatedly while it sits below one. The stamp is cleared the
// moment the balance recovers, so the next dip alerts immediately.
//
// This used to be a 6-hour timer per severity, which meant a balance that
// simply stayed low produced up to FOUR emails a day (warn + alarm, four
// windows) plus an SMS on every alarm — and a second, independent VerifyNow
// alert in KycService on top. Nothing was wrong; the operator was being told
// the same fact over and over. An alert you receive twelve times is one you
// stop reading, which is worse than not sending it.
//
// The floor below is the only repeat: if a balance is STILL below the line a
// week later, say so once more, because silence on a genuinely unresolved
// problem is its own failure.
const CREDIT_ALERT_REPEAT_FLOOR_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  // DD-4 — re-entrancy guard: @Cron(EVERY_MINUTE) re-fires on tick even if the
  // previous invocation is still running, so a >60s sweep could overlap itself.
  // The go-live transitions are CAS-guarded (idempotent), but this also avoids
  // redundant work + duplicate drop pushes.
  private dealDropRunning = false;
  // DD-F — re-entrancy guard for the hourly deal-PO retry: a slow Zoho batch
  // must not overlap the next tick (retryMissingDealPurchaseOrders is bounded
  // + idempotent, but this avoids redundant work).
  private dealPoRetryRunning = false;
  // DD-F — re-entrancy guard for the hourly stock-ready collection re-book
  // sweep (courier calls can be slow; bookings are idempotent but sequential).
  private dealCollectionSweepRunning = false;
  private statsRollupRunning = false;

  constructor(
    private readonly offersService: OffersService,
    private readonly auctionsService: AuctionsService,
    private readonly kycService: KycService,
    private readonly trackingService: TrackingService,
    private readonly shipping: ShippingService,
    private readonly dispatchSla: DispatchSlaService,
    private readonly transactions: TransactionsService,
    private readonly prisma: PrismaService,
    private readonly adminCredits: AdminCreditsService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly push: PushService,
    private readonly zohoBooks: ZohoBooksService,
    private readonly savedSearches: SavedSearchesService,
    private readonly deals: DealsService,
    private readonly ratings: RatingsService,
    private readonly settings: SettingsService,
    private readonly wishlistAlerts: WishlistAlertsService,
    private readonly health: AdminHealthService,
    private readonly listings: ListingsService,
  ) {}

  // Process start time — the cron watchdog skips its first STARTUP_GRACE
  // window so a just-restarted instance (whose fast crons haven't fired their
  // first heartbeat yet) can't false-alarm on a pre-restart 'stale' stamp.
  private readonly bootAt = new Date();

  // The manual-EFT inContact inbox-scan cron and the 09:00 FNB payout-batch
  // reminder cron have been removed with the manual-EFT rail (no reconciler,
  // no FNB bulk-payment batch). Seller payouts / buyer refunds are still
  // surfaced read-only via the admin payouts-due preview.

  // ─── Firearm licence expiry — auto-delist + warnings ─────────────
  // Daily: any ACTIVE firearm listing whose licence is ≤30 days from
  // expiry (or already expired) is delisted (status EXPIRED) and the
  // seller is told to renew + relist. Listings in the 31–90-day window
  // get a one-time "expiring soon" warning (licenceExpiryWarnedAt guards
  // against re-warning daily).
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkFirearmLicenceExpiry() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const fullName = (f?: string | null, l?: string | null) =>
      [f, l].filter(Boolean).join(' ') || 'there';
    try {
      // (1) Delist anything ≤30 days from expiry (or already expired).
      const toDelist = await this.prisma.listing.findMany({
        where: {
          isFirearm: true,
          status: 'ACTIVE',
          licenceExpiresAt: { not: null, lte: in30 },
        },
        select: {
          id: true,
          title: true,
          seller: { select: { email: true, firstName: true, lastName: true } },
        },
      });
      for (const l of toDelist) {
        await this.prisma.listing.update({
          where: { id: l.id },
          data: { status: 'EXPIRED' },
        });
        if (l.seller?.email) {
          await this.notifications.firearmLicenceExpiry({
            sellerEmail: l.seller.email,
            sellerName: fullName(l.seller.firstName, l.seller.lastName),
            listingTitle: l.title,
            listingId: l.id,
            kind: 'delisted',
          });
        }
      }

      // (2) One-time warning for the 31–90-day window.
      const toWarn = await this.prisma.listing.findMany({
        where: {
          isFirearm: true,
          status: 'ACTIVE',
          licenceExpiryWarnedAt: null,
          licenceExpiresAt: { gt: in30, lte: in90 },
        },
        select: {
          id: true,
          title: true,
          licenceExpiresAt: true,
          seller: { select: { email: true, firstName: true, lastName: true } },
        },
      });
      for (const l of toWarn) {
        await this.prisma.listing.update({
          where: { id: l.id },
          data: { licenceExpiryWarnedAt: now },
        });
        if (l.seller?.email && l.licenceExpiresAt) {
          const daysLeft = Math.max(
            0,
            Math.floor(
              (l.licenceExpiresAt.getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          );
          await this.notifications.firearmLicenceExpiry({
            sellerEmail: l.seller.email,
            sellerName: fullName(l.seller.firstName, l.seller.lastName),
            listingTitle: l.title,
            listingId: l.id,
            kind: 'warn',
            daysLeft,
          });
        }
      }

      if (toDelist.length || toWarn.length) {
        this.logger.log(
          `firearm licence expiry: delisted ${toDelist.length}, warned ${toWarn.length}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `checkFirearmLicenceExpiry failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('firearm-licence-expiry');
    }
  }

  // ─── Stale-listing expiry + refresh ─────────────────────────────
  // Only FIREARM listings were ever auto-delisted (licence-expiry cron above).
  // Every other listing stayed ACTIVE forever: no expiry, no "is this still
  // for sale?" check. Dead inventory accumulated, buyers wasted offers/bids on
  // items sold elsewhere months ago — and under the reject-strike policy the
  // seller then ate a strike for declining an offer on a listing they'd
  // forgotten. Two daily passes, both one-shot per listing:
  //   1. 75 days since lastRenewedAt → "still for sale?" nudge (renewalNudgedAt).
  //   2. 90 days → EXPIRED + de-indexed + one-tap relist.
  // Age is measured on lastRenewedAt (seeded from createdAt at migration, bumped
  // only by an explicit renew/relist) NOT updatedAt — updatedAt is touched by
  // unrelated writes (offer counters, moderation edits) which would silently
  // keep dead listings alive forever. AUCTIONS are excluded (they have their own
  // endTime lifecycle), as are house deal listings.
  @Cron('0 4 * * *')
  async staleListingSweep() {
    const NUDGE_DAYS = 75;
    const EXPIRE_DAYS = 90;
    const now = new Date();
    const nudgeCutoff = new Date(now.getTime() - NUDGE_DAYS * 86_400_000);
    const expireCutoff = new Date(now.getTime() - EXPIRE_DAYS * 86_400_000);
    const daysSince = (d: Date) =>
      Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    try {
      // 1. Expire first (so a listing crossing both thresholds in one run
      //    expires rather than being nudged about a listing we then expire).
      const toExpire = await this.prisma.listing.findMany({
        where: {
          status: 'ACTIVE',
          listingType: { not: 'AUCTION' },
          isDealListing: false,
          lastRenewedAt: { lte: expireCutoff },
        },
        select: {
          id: true,
          title: true,
          lastRenewedAt: true,
          seller: { select: { email: true, firstName: true } },
        },
        take: 200,
      });
      for (const l of toExpire) {
        // CAS on status so a concurrent sale/edit wins over the expiry.
        const claim = await this.prisma.listing.updateMany({
          where: { id: l.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });
        if (claim.count === 0) continue;
        await this.listings.removeFromIndex(l.id);
        if (l.seller?.email) {
          await this.notifications
            .listingStale({
              sellerEmail: l.seller.email,
              sellerName: l.seller.firstName ?? 'Seller',
              listingTitle: l.title,
              listingId: l.id,
              kind: 'expired',
              daysOld: daysSince(l.lastRenewedAt),
            })
            .catch((err) =>
              this.logger.warn(
                `stale-expire notify failed for ${l.id}: ${(err as Error).message}`,
              ),
            );
        }
      }

      // 2. One-shot "still for sale?" nudge in the 75–90 day window.
      const toNudge = await this.prisma.listing.findMany({
        where: {
          status: 'ACTIVE',
          listingType: { not: 'AUCTION' },
          isDealListing: false,
          renewalNudgedAt: null,
          lastRenewedAt: { lte: nudgeCutoff, gt: expireCutoff },
        },
        select: {
          id: true,
          title: true,
          lastRenewedAt: true,
          seller: { select: { email: true, firstName: true } },
        },
        take: 200,
      });
      for (const l of toNudge) {
        const claim = await this.prisma.listing.updateMany({
          where: { id: l.id, renewalNudgedAt: null },
          data: { renewalNudgedAt: now },
        });
        if (claim.count === 0) continue;
        if (l.seller?.email) {
          await this.notifications
            .listingStale({
              sellerEmail: l.seller.email,
              sellerName: l.seller.firstName ?? 'Seller',
              listingTitle: l.title,
              listingId: l.id,
              kind: 'nudge',
              daysOld: daysSince(l.lastRenewedAt),
            })
            .catch((err) =>
              this.logger.warn(
                `stale-nudge notify failed for ${l.id}: ${(err as Error).message}`,
              ),
            );
        }
      }

      if (toExpire.length > 0 || toNudge.length > 0) {
        this.logger.log(
          `Stale listings: expired ${toExpire.length}, nudged ${toNudge.length}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `staleListingSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('stale-listing-sweep');
    }
  }

  // ─── Photo-less ACTIVE listing sweep ────────────────────────────
  // create() sets a moderation-approved listing ACTIVE before any photo has
  // uploaded; photos then stream up one-by-one from the client. If the
  // seller's browser/PWA dies mid-upload the client-side rollback DELETE never
  // fires and an ACTIVE zero-photo listing sits in search indefinitely. Flip
  // those back to DRAFT (NOT PENDING_REVIEW — that would pollute the admin
  // review queue with non-moderation work), de-index, and tell the seller.
  // 1h grace so a genuinely in-progress upload is never touched.
  @Cron(CronExpression.EVERY_HOUR)
  async photolessListingSweep() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    try {
      const orphans = await this.prisma.listing.findMany({
        where: {
          status: 'ACTIVE',
          isDealListing: false,
          createdAt: { lte: cutoff },
          images: { none: {} },
        },
        select: {
          id: true,
          title: true,
          seller: { select: { email: true, firstName: true } },
        },
        take: 100,
      });
      let fixed = 0;
      for (const l of orphans) {
        // CAS on status — a photo landing (or an admin action) mid-sweep wins.
        const claim = await this.prisma.listing.updateMany({
          where: { id: l.id, status: 'ACTIVE' },
          data: { status: 'DRAFT' },
        });
        if (claim.count === 0) continue;
        // Re-check: a photo may have landed between the findMany and the CAS.
        const imageCount = await this.prisma.listingImage.count({
          where: { listingId: l.id },
        });
        if (imageCount > 0) {
          // False positive — put it straight back.
          await this.prisma.listing.updateMany({
            where: { id: l.id, status: 'DRAFT' },
            data: { status: 'ACTIVE' },
          });
          continue;
        }
        await this.listings.removeFromIndex(l.id);
        fixed++;
        if (l.seller?.email) {
          await this.notifications
            .listingPhotosMissing({
              sellerEmail: l.seller.email,
              sellerName: l.seller.firstName ?? 'Seller',
              listingTitle: l.title,
              listingId: l.id,
            })
            .catch((err) =>
              this.logger.warn(
                `photo-less notify failed for ${l.id}: ${(err as Error).message}`,
              ),
            );
        }
      }
      if (fixed > 0) {
        this.logger.log(`Photo-less sweep: moved ${fixed} listing(s) to DRAFT`);
      }
    } catch (err) {
      this.logger.error(
        `photolessListingSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('photoless-listing-sweep');
    }
  }

  // Recover PRIVATE_ARRANGE sales stranded paid+HELD (crash between markPaid
  // and the immediate-payout fire-and-forget). Small, idempotent, cheap.
  // DD-2 — the SAME sweep also re-drives Daily Deals house-deal auto-accept
  // for any house sale stranded paid+HELD+unaccepted (identical crash window).
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileStrandedPrivateArrange() {
    this.logger.debug('Running PRIVATE_ARRANGE + house-deal reconcile');
    try {
      await this.transactions.reconcileStrandedPrivateArrange();
    } catch (err) {
      this.logger.error(
        `reconcileStrandedPrivateArrange failed: ${(err as Error).message}`,
      );
    }
    try {
      await this.transactions.reconcileStrandedHouseDeals();
    } catch (err) {
      this.logger.error(
        `reconcileStrandedHouseDeals failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('pa-payout-reconcile');
    }
  }

  // ─── Orphan reserve-tx reclaim ───────────────────────────────────
  // The manual-EFT freeze-expiry + 12h/1h payment-reminder passes have been
  // removed with the manual-EFT rail (checkout is gated by assertPaymentsLive
  // so no unpaid manual reservations are created). This safety-net remains: a
  // checkout that died between reserving a line and finishing (single-item or
  // cart) can leave a never-paid HELD tx with no orderId / peachCheckoutId /
  // swapId, its reserved listing stranded and invisible to every other sweep.
  // Reclaim them (release the listing + delete the tx). Also picks up gateway/
  // cart orphans once a paygate lands, since a gateway checkout that failed
  // before persisting its checkout id matches the same shape.
  //
  // The filter is tight enough it can NEVER touch a live tx: a gateway tx has
  // peachCheckoutId; an order child has orderId; a paid/refunded tx has paidAt;
  // a SWOP leg has a swapId. The 15-min age floor protects an in-flight
  // same-request tx.
  //
  // swapId: null is LOAD-BEARING. A swap creates two ZERO-money Transaction
  // legs that carry NO orderId / peachCheckoutId / paidAt — they match every
  // other orphan condition. Without this guard the sweep would delete both legs
  // + un-reserve both listings ~15 min after every swap was agreed, orphaning
  // the Swap parent. The legs' lifecycle is owned by the swap flow.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reclaimOrphanReservations() {
    const now = new Date();
    try {
      const orphanCutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const orphans = await this.prisma.transaction.findMany({
        where: {
          paidAt: null,
          orderId: null,
          peachCheckoutId: null,
          swapId: null,
          createdAt: { lt: orphanCutoff },
        },
        select: {
          id: true,
          listingId: true,
          quantity: true,
          listing: { select: { trackInventory: true, listingType: true } },
        },
        take: 50,
      });
      for (const o of orphans) {
        try {
          await this.prisma.$transaction([
            o.listing.trackInventory
              ? this.prisma.listing.update({
                  where: { id: o.listingId },
                  data: {
                    status: 'ACTIVE',
                    quantityAvailable: { increment: o.quantity },
                    quantityReserved: { decrement: o.quantity },
                  },
                })
              : this.prisma.listing.updateMany({
                  where: { id: o.listingId, status: 'PAYMENT_PENDING' },
                  // P0.2 — an orphaned ENDED-auction reserve releases to
                  // EXPIRED, never back to ACTIVE (unbuyable-zombie fix).
                  data: {
                    status:
                      o.listing.listingType === 'AUCTION' ? 'EXPIRED' : 'ACTIVE',
                  },
                }),
            this.prisma.transaction.delete({ where: { id: o.id } }),
          ]);
          this.logger.warn(
            `Reclaimed orphan reserve-tx ${o.id} — listing ${o.listingId} released`,
          );
        } catch (err) {
          this.logger.warn(
            `orphan reclaim failed for ${o.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `reclaimOrphanReservations failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('orphan-reclaim');
    }
  }

  // ─── FLOW-F3 — Order.status rollup ───────────────────────────────
  // Order.status previously froze at PAID forever. This sweep advances a
  // PAID order to its terminal state once EVERY line (child transaction,
  // excluding synthetic refund children) is itself terminal:
  //   all RELEASED → COMPLETED · all REFUNDED → REFUNDED · mixed →
  //   PARTIALLY_FULFILLED. Decoupled catch-all: covers every release/refund
  //   path (confirm-delivery, dealer-verify, reject, cancel, admin, SLA)
  //   without threading a call through each money site. Runs every 15 min.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async orderStatusRollupSweep() {
    try {
      const paidOrders = await this.prisma.order.findMany({
        where: { status: 'PAID' },
        select: {
          id: true,
          transactions: {
            where: { refundOfId: null }, // exclude synthetic refund children
            select: { paymentStatus: true },
          },
        },
        take: 200,
      });
      let advanced = 0;
      for (const order of paidOrders) {
        const rollup = computeOrderRollupStatus(
          order.transactions.map((t) => t.paymentStatus),
        );
        if (!rollup) continue; // still in flight
        const claim = await this.prisma.order.updateMany({
          where: { id: order.id, status: 'PAID' },
          data: { status: rollup },
        });
        if (claim.count > 0) advanced++;
      }
      if (advanced > 0) {
        this.logger.log(`orderStatusRollupSweep: advanced ${advanced} order(s)`);
      }
    } catch (err) {
      this.logger.error(
        `orderStatusRollupSweep failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('order-status-rollup');
    }
  }

  // ─── Push subscription cleanup ───────────────────────────────────
  // Runs once a week. Drops subscriptions where lastUsedAt is older
  // than 90 days (the user almost certainly uninstalled the PWA or
  // cleared their service-worker storage; we'd just keep getting
  // 410s on every push). Stops the table growing forever.
  //
  // Live failures still prune immediately via PushService.sendToUser's
  // 410 handler — this cron just sweeps up the long-tail of subs that
  // we've STOPPED trying to push to (because the user has no recent
  // notifiable events) but which never got marked dead.
  @Cron(CronExpression.EVERY_WEEK)
  async pushSubscriptionPrune() {
    try {
      const removed = await this.push.pruneStale(90);
      if (removed > 0) {
        this.logger.log(`pushSubscriptionPrune: removed ${removed} stale subs`);
      }
    } catch (err) {
      this.logger.error(
        `pushSubscriptionPrune failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('push-prune');
    }
  }

  // Stamp the Setting table with this cron's last successful run.
  // Powers the /admin/health "Cron status" panel — admin can see at a
  // glance which crons are firing and which are stale. Best-effort:
  // a failed write here doesn't stop the cron from completing.
  // ────────────────────────────────────────────────────────────────
  // OPERATIONS ALERTS -> THE OPERATOR'S PHONE
  // ────────────────────────────────────────────────────────────────
  //
  // Fifty-two places in this codebase raise an urgent AdminAlert and NOTHING
  // has ever watched them. They land in /admin/alerts and wait to be noticed.
  // For most of them that is fine. For a backup that failed it is not: nobody
  // opens the admin inbox to check whether last night worked, and the whole
  // value of a backup is knowing it is there BEFORE you need it.
  //
  // TWO THINGS ARE WATCHED, because they are different failures:
  //
  //   AN UNRESOLVED URGENT ALERT  — something ran and reported a problem.
  //   A STALE HEARTBEAT           — something did not run at all. The on-box
  //                                 script cannot report this about itself: a
  //                                 cron that was removed, or a box that was
  //                                 off, has nothing left to speak with.
  //
  // ⚠️ IT CANNOT COVER EVERYTHING. If the whole box is down, this is down too.
  // An external uptime check is the only thing that catches that, and there
  // isn't one.
  //
  // DELIBERATELY NARROW. ops_alert_types defaults to BACKUP_FAILED alone.
  // Texting all fifty-two would train the operator to ignore the messages,
  // which is worse than sending none. Widen it one type at a time.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async opsAlertWatch(): Promise<void> {
    try {
      const [phone, types, quietHours] = await Promise.all([
        this.settings.get(FLAGS.opsAlertPhone),
        this.settings.get(FLAGS.opsAlertTypes),
        this.settings.get(FLAGS.opsAlertQuietHours),
      ]);
      if (!phone || !types.length) return;

      const [alerts, beat, last] = await Promise.all([
        this.prisma.adminAlert.findMany({
          where: { resolved: false, urgent: true, type: { in: types } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { type: true, context: true },
        }),
        this.prisma.setting.findUnique({
          where: { key: 'cron:lastrun:box-backup' },
        }),
        this.prisma.setting.findUnique({ where: { key: 'ops:alert:last' } }),
      ]);

      // Every decision is made by the pure module; this method only does IO.
      const decision = decideOpsAlert({
        alerts,
        backupLastRun: beat?.updatedAt ?? null,
        lastFingerprint: last?.value ?? null,
        config: { phone, quietHours },
        now: new Date(),
      });

      if (decision.clear) {
        await this.prisma.setting
          .deleteMany({ where: { key: 'ops:alert:last' } })
          .catch(() => undefined);
        return;
      }
      if (!decision.send || !decision.message) return;

      const res = await this.sms.sendSms({
        to: phone,
        message: decision.message,
        reference: 'ops-alert',
      });

      if (!res.success) {
        // NOT recorded, so the next pass tries again. The alternative is a
        // failed send that silently counts as delivered.
        this.logger.error('Ops alert SMS failed to send');
        return;
      }

      await this.prisma.setting.upsert({
        where: { key: 'ops:alert:last' },
        create: { key: 'ops:alert:last', value: decision.fingerprint! },
        update: { value: decision.fingerprint! },
      });

      if (res.stub) {
        // A STUB IS NOT A SENT MESSAGE. SmsService reports success with
        // stub:true when SMSPortal is unconfigured — it wrote a log row and
        // nothing left the building. Recorded anyway so this does not repeat
        // every half hour, but said plainly: "alerts are wired up" and "alerts
        // arrive" are different claims.
        this.logger.error(
          'Ops alert was STUBBED, not sent — SMSPortal is not configured. The operator was told nothing.',
        );
      } else {
        this.logger.warn('Ops alert texted to the operator');
      }
    } catch (err) {
      this.logger.error(`opsAlertWatch failed: ${(err as Error).message}`);
    } finally {
      await this.recordCronRun('ops-alert-watch');
    }
  }

  private async recordCronRun(key: string): Promise<void> {
    try {
      await this.prisma.setting.upsert({
        where: { key: `cron:lastrun:${key}` },
        create: { key: `cron:lastrun:${key}`, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    } catch (err) {
      this.logger.warn(
        `recordCronRun(${key}) failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── DD-4 — Daily Deals scheduled drops ──────────────────────────
  // Every minute: auto go-live SCHEDULED deals whose start has arrived,
  // auto-END deals at their endsAt / extendedUntil (the hard time-gate the
  // buy path lacks — closes the DD-3 "buyable past the advertised end" gap),
  // run "Extra Time", and enforce the deals_enabled killswitch. INERT while
  // there are no scheduled/live deals (the queries return empty → no-op, so
  // this ships safely with the flag off + zero deals). Each newly-live deal
  // is announced via web-push to opted-in BUYER devices when
  // deal_push_enabled. Outer try/catch + recordCronRun('deal-drops') so one
  // bad deal can't stall the sweep and the health dashboard sees a heartbeat.
  @Cron(CronExpression.EVERY_MINUTE)
  async dailyDealDrops() {
    if (this.dealDropRunning) return; // a previous sweep is still running
    this.dealDropRunning = true;
    try {
      const { dropped } = await this.deals.runScheduledDrops();
      if (dropped.length === 0) return;
      const pushOn = await this.settings.get(FLAGS.dealPushEnabled);
      if (!pushOn) return;
      for (const d of dropped) {
        // Match the storefront/PDP whole-rand display for whole-rand deals (the
        // norm); show cents only when the price actually has cents so the push
        // never advertises a price BELOW what checkout charges (CPA).
        const rands = d.dealPriceCents / 100;
        const price = `R${Number.isInteger(rands) ? rands : rands.toFixed(2)}`;
        await this.push
          .broadcast(NotificationCategory.BUYER, {
            title: '🔥 New Daily Deal',
            body:
              d.savePct > 0
                ? `${d.title} — save ${d.savePct}%, now ${price}`
                : `${d.title} — now ${price}`,
            url: `/deals/${d.id}`,
            tag: `deal-${d.id}`, // dedup: one notification per deal
          })
          .catch((err) =>
            this.logger.warn(
              `deal-drop push for ${d.id} failed: ${(err as Error).message}`,
            ),
          );
      }
    } catch (err) {
      this.logger.error(
        `dailyDealDrops failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.dealDropRunning = false;
      await this.recordCronRun('deal-drops');
    }
  }

  // AUDIT M15 — every cron below wraps work in try/catch with
  // recordCronRun in finally. A DB hiccup in the leading findMany
  // would otherwise skip the heartbeat, leaving the admin health
  // dashboard stale and masking outages.

  // Run every 10 minutes — expire pending/countered offers past their TTL.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireOffers() {
    this.logger.debug('Running offer expiry cron');
    try {
      await this.offersService.expireStale();
    } catch (err) {
      this.logger.error(
        `expireOffers failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    // Remind sellers/buyers BEFORE an offer lapses — separate try so an
    // expiry failure never blocks the reminder pass and vice-versa.
    try {
      await this.offersService.remindExpiring();
    } catch (err) {
      this.logger.warn(`offer reminders failed: ${(err as Error).message}`);
    } finally {
      await this.recordCronRun('offer-expire');
    }
  }

  // Daily 03:00 — refresh trust scores for sellers with recent activity
  // (the dashboard no longer recomputes on view, so the time-based score
  // components refresh here instead).
  @Cron('0 3 * * *')
  async refreshTrustScores() {
    this.logger.debug('Running trust-score refresh cron');
    try {
      const n = await this.ratings.recalcRecentSellers();
      if (n > 0) this.logger.log(`Trust scores refreshed for ${n} seller(s)`);
    } catch (err) {
      this.logger.error(
        `refreshTrustScores failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('trust-score-refresh');
    }
  }

  // Every 10 min — re-attempt notification emails parked in the outbox
  // after a transport failure (normally a no-op; the table stays empty).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryOutboxEmails() {
    this.logger.debug('Running email outbox retry cron');
    try {
      await this.notifications.retryOutboxEmails();
    } catch (err) {
      this.logger.error(
        `retryOutboxEmails failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('email-outbox-retry');
    }
  }

  // Every 10 min — re-attempt FAILED-but-retryable SMS (PIN/waybill/refund/
  // reminder), mirroring the email outbox. OTP flows are excluded at write
  // time. Also raises an SMSPortal-outage alert on a run of consecutive
  // failures. Normally a no-op.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryFailedSms() {
    try {
      const r = await this.sms.retryFailed();
      if (r.sent > 0 || r.exhausted > 0) {
        this.logger.log(
          `SMS retry: ${r.sent} sent, ${r.exhausted} exhausted of ${r.retried}`,
        );
      }
    } catch (err) {
      this.logger.warn(`retryFailedSms failed: ${(err as Error).message}`);
    } finally {
      await this.recordCronRun('sms-retry');
    }
  }

  // Hourly — self-heal FAILED/stranded commission invoices + missing
  // subscription sales receipts (previously manual-retry only; a Zoho
  // outage during a release window would silently leave holes in Books).
  @Cron(CronExpression.EVERY_HOUR)
  async retryRevenueDocs() {
    this.logger.debug('Running Zoho revenue-doc retry cron');
    try {
      await this.zohoBooks.retryFailedRevenueDocs();
    } catch (err) {
      this.logger.error(
        `retryRevenueDocs failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('zoho-revenue-doc-retry');
    }
  }

  // DD-F — hourly retry for deal purchase orders that never reached Zoho (the
  // DealPurchaseOrder row is missing) or failed at placement (zohoSyncStatus
  // FAILED). createDealPurchaseOrder is idempotent (guarded by the row + its
  // zohoPurchaseOrderId), so a re-fire can only fill the gap — keeps Books
  // whole without an admin clicking retry.
  // INERT until deals go live + POs exist (the query returns empty → no-op).
  @Cron(CronExpression.EVERY_HOUR)
  async retryDealPurchaseOrders() {
    if (this.dealPoRetryRunning) return; // a previous run is still going
    this.dealPoRetryRunning = true;
    try {
      await this.zohoBooks.retryMissingDealPurchaseOrders(25);
    } catch (err) {
      this.logger.error(
        `retryDealPurchaseOrders failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.dealPoRetryRunning = false;
      await this.recordCronRun('deal-po-retry');
    }
  }

  // DD-F — hourly re-attempt for supplier collections still unbooked after the
  // operator tapped "Stock ready" (a crash or TCG error inside
  // markStockReadyAndBook would otherwise strand them until an admin notices
  // the attention card). The sweep only re-drives bookings the admin tap
  // already authorised — it can never initiate new courier spend on its own —
  // and every booking is idempotent + HELD-gated in ShippingService. INERT
  // until deals go live (no stock-ready POs with unbooked lines → no-op).
  @Cron(CronExpression.EVERY_HOUR)
  async sweepDealCollections() {
    if (this.dealCollectionSweepRunning) return; // a previous run is still going
    this.dealCollectionSweepRunning = true;
    try {
      await this.deals.sweepUnbookedStockReadyCollections();
    } catch (err) {
      this.logger.error(
        `sweepDealCollections failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.dealCollectionSweepRunning = false;
      await this.recordCronRun('deal-collection-sweep');
    }
  }

  // P5.1 — Saved-search alerts. Every 10 min: for each enabled SavedSearch,
  // find ACTIVE listings published since its notify cursor and alert the
  // owner (in-app + push), then advance the cursor. Thin delegator; the
  // per-search try/catch + batch caps live in the service. Heartbeat in
  // finally so /admin/health shows it firing even on a bad tick.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async savedSearchMatchSweep() {
    try {
      const res = await this.savedSearches.matchAndNotify();
      if (res.notified > 0) {
        this.logger.log(
          `Saved-search alerts: notified ${res.notified} of ${res.scanned} searches`,
        );
      }
    } catch (err) {
      this.logger.error(
        `savedSearchMatchSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('saved-search-match');
    }
  }

  // Run every minute — finalize auctions whose endTime has passed, and
  // expire won auctions whose winner never started checkout inside the
  // 24h pay window (P0.2).
  @Cron(CronExpression.EVERY_MINUTE)
  async endAuctions() {
    try {
      const result = await this.auctionsService.endStale();
      if (result.processed > 0) {
        this.logger.log(`Finalised ${result.processed} auction(s)`);
      }
      const unpaid = await this.auctionsService.sweepUnpaidWins();
      if (unpaid.expired > 0) {
        this.logger.log(`Expired ${unpaid.expired} unpaid auction win(s)`);
      }
      // Nudge winners ~6h before the pay window lapses (before the strike).
      const reminded = await this.auctionsService.remindUnpaidWinners();
      if (reminded.reminded > 0) {
        this.logger.log(`Reminded ${reminded.reminded} unpaid auction winner(s)`);
      }
      // Alert wishlisters that a saved auction is closing within the hour.
      await this.wishlistAlerts.sweepEndingSoonAuctions();
    } catch (err) {
      this.logger.error(
        `endAuctions failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('auction-end');
    }
  }

  // Run every 5 minutes — refresh the cached VerifyNow credit balance
  // so the admin panel always shows a recent number. /my_credits is a
  // free call (doesn't burn a credit) so polling is cheap. Fails open:
  // if VerifyNow is unreachable we log and leave the stale cache in
  // place rather than nuke it.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshVerifyNowBalance() {
    try {
      await this.kycService.refreshCreditBalance();
    } catch (err) {
      this.logger.warn(
        `VerifyNow balance refresh failed: ${(err as Error).message}`,
      );
    }
    await this.recordCronRun('verifynow-balance');
  }

  // Run every 10 minutes — poll Pudo's tracking endpoint for every
  // active PUDO shipment, append new carrier events to the per-
  // transaction TrackingEvent log, and roll Transaction.shippingStatus
  // forward in lockstep with the collapsed status. The polling-vs-
  // webhook trade-off was deliberate (Pudo webhooks need a support
  // email to enable) — at 10 min granularity the buyer's timeline is
  // never more than 10 min stale, which is acceptable for a parcel
  // service whose carrier scans are minutes-apart at best.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollTrackingEvents() {
    try {
      const result = await this.trackingService.pollPudoShipments();
      if (result.ingested > 0) {
        this.logger.log(
          `Pudo tracking poll: scanned ${result.scanned}, ingested ${result.ingested} new event(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Pudo tracking poll failed: ${(err as Error).message}`);
    }
    await this.recordCronRun('shipping-poll');
  }

  // Resolve Bob Go bookings the courier had not yet accepted.
  //
  // Bob Go answers HTTP 201 for a shipment and only afterwards reports whether
  // a courier took it, so bookForTransaction can end with a shipment that
  // exists but is not agreed. Those rows are deliberately left un-stamped, the
  // seller is deliberately not told, and the booking claim is deliberately held
  // — which makes this sweep the only thing that will ever finish them.
  //
  // Every 5 minutes: fast enough that a seller waiting on a waybill is not left
  // wondering, cheap enough to be harmless — the whole sweep is ONE Bob Go
  // request regardless of how many rows are pending, and it returns immediately
  // when there are none. Inert while the Bob Go rail is off, because no row can
  // have carrierProvider BOBGO.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async resolvePendingBobGoBookings() {
    try {
      const r = await this.shipping.resolvePendingBobGoBookings();
      if (r.checked > 0) {
        this.logger.log(
          `Bob Go pending bookings: ${r.checked} checked, ${r.booked} accepted, ${r.failed} refused, ${r.stillPending} still waiting`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Bob Go pending-booking sweep failed: ${(err as Error).message}`,
      );
    }
    await this.recordCronRun('bobgo-pending-bookings');
  }

  // Dispatch SLA — both passes run hourly. Cheap (one indexed query
  // each) and there's no benefit to running more often: the buyer
  // doesn't perceive a difference between "nudged at 48h0m" and
  // "nudged at 48h45m". Two passes share one cron tick to keep the
  // task log tight.
  @Cron(CronExpression.EVERY_HOUR)
  async dispatchSlaSweep() {
    try {
      const nudge = await this.dispatchSla.nudgeStale();
      if (nudge.nudged > 0) {
        this.logger.log(
          `Dispatch SLA nudges sent: ${nudge.nudged} of ${nudge.scanned}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Dispatch SLA nudge failed: ${(err as Error).message}`);
    }
    try {
      const refund = await this.dispatchSla.autoRefundStale();
      if (refund.refunded > 0) {
        this.logger.log(
          `Dispatch SLA auto-refunds: ${refund.refunded} of ${refund.scanned}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Dispatch SLA auto-refund failed: ${(err as Error).message}`,
      );
    }
    // FLOW-F4 — DEALER_TRANSFER stall backstop (the courier passes above skip
    // DT by design). Seller nudge past the 5-day accept→transfer window, then
    // an urgent admin alert after a 48h grace. NO auto-refund on this path.
    try {
      const dt = await this.dispatchSla.sweepStalledDealerTransfers();
      if (dt.nudged > 0 || dt.alerted > 0) {
        this.logger.log(
          `DT stall sweep: nudged ${dt.nudged}, alerted ${dt.alerted} of ${dt.scanned}`,
        );
      }
    } catch (err) {
      this.logger.warn(`DT stall sweep failed: ${(err as Error).message}`);
    }
    // FLOW-F6 — COLLECTION stall backstop (courier + DT passes above all skip
    // COLLECTION by design). Buyer collection-confirm nudge past the 5-day
    // accept window, then an urgent admin alert after a 48h grace. NO
    // auto-refund on this path.
    try {
      const col = await this.dispatchSla.sweepStalledCollection();
      if (col.nudged > 0 || col.alerted > 0) {
        this.logger.log(
          `Collection stall sweep: nudged ${col.nudged}, alerted ${col.alerted} of ${col.scanned}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Collection stall sweep failed: ${(err as Error).message}`,
      );
    }
    // In-transit stall — dispatched courier parcels with no scan progress >7d.
    try {
      const transit = await this.dispatchSla.sweepStalledInTransit();
      if (transit.alerted > 0) {
        this.logger.log(
          `In-transit stall: alerted ${transit.alerted} of ${transit.scanned}`,
        );
      }
    } catch (err) {
      this.logger.warn(`In-transit stall sweep failed: ${(err as Error).message}`);
    }
    await this.recordCronRun('dispatch-sla');
  }

  // P5.3 — stuck HELD funds: courier orders delivered >72h ago that the buyer
  // never confirmed. Raises a one-shot admin alert (NO auto-release — operator
  // decision); the admin reviews + manually releases from the dossier. Hourly,
  // heartbeat in finally.
  @Cron(CronExpression.EVERY_HOUR)
  async stuckHeldFundsSweep() {
    // 48h confirm-receipt nudge FIRST (self-heals forgetful buyers before the
    // 72h admin alert below has to involve a human). Separate try so one pass
    // failing never blocks the other.
    try {
      const nudge = await this.dispatchSla.nudgeUnconfirmedReceipt();
      if (nudge.nudged > 0) {
        this.logger.log(
          `Confirm-receipt nudge: ${nudge.nudged} of ${nudge.scanned} buyer(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `confirm-receipt nudge failed: ${(err as Error).message}`,
      );
    }
    try {
      const res = await this.dispatchSla.alertStuckHeldFunds();
      if (res.alerted > 0) {
        this.logger.log(
          `Stuck-held-funds: alerted admin on ${res.alerted} of ${res.scanned} order(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `stuckHeldFundsSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('stuck-held-funds');
    }
  }

  // FLOW-F4 (H17/M19) — dealer-verification ageing sweep. Two failure modes
  // that previously had no backstop:
  //   1. PENDING_ADMIN_REVIEW older than 48h — the promised human-review SLA
  //      breached, funds still HELD. Escalate an urgent alert (deduped against
  //      an existing unresolved overdue alert for the same tx).
  //   2. PENDING_CLAUDE older than 1h — uploadAndScore crashed mid-scan before
  //      writing the final status, so the row is wedged in an in-progress state
  //      no process will ever finish. Flip it to PENDING_ADMIN_REVIEW (atomic
  //      CAS on the stuck status = idempotency guard) so a human decides, and
  //      alert. Hourly, heartbeat in finally.
  @Cron(CronExpression.EVERY_HOUR)
  async dealerVerificationAgeingSweep() {
    const now = Date.now();
    const reviewCutoff = new Date(now - 48 * 60 * 60 * 1000);
    const scanCutoff = new Date(now - 60 * 60 * 1000);
    try {
      // 1. PENDING_ADMIN_REVIEW > 48h — SLA breached.
      const overdue = await this.prisma.transaction.findMany({
        where: {
          dealerVerificationStatus: 'PENDING_ADMIN_REVIEW',
          paymentStatus: 'HELD',
          updatedAt: { lte: reviewCutoff },
        },
        select: {
          id: true,
          listing: { select: { make: true, model: true } },
        },
        take: 100,
      });
      for (const tx of overdue) {
        const existing = await this.prisma.adminAlert.count({
          where: {
            type: 'DEALER_VERIFICATION_REVIEW_OVERDUE',
            referenceId: tx.id,
            resolved: false,
          },
        });
        if (existing > 0) continue;
        await this.prisma.adminAlert.create({
          data: {
            type: 'DEALER_VERIFICATION_REVIEW_OVERDUE',
            referenceId: tx.id,
            urgent: true,
            context:
              `Firearm verification ${tx.id.slice(-8).toUpperCase()} ` +
              `(${[tx.listing.make, tx.listing.model].filter(Boolean).join(' ') || 'firearm'}) ` +
              `has sat in admin review over 48h — buyer's payment is still HELD. ` +
              `Resolve it from the transaction dossier.`,
          },
        });
      }

      // 2. PENDING_CLAUDE > 1h — crashed mid-scan; flip to review + alert.
      const stuckScan = await this.prisma.transaction.findMany({
        where: {
          dealerVerificationStatus: 'PENDING_CLAUDE',
          updatedAt: { lte: scanCutoff },
        },
        select: {
          id: true,
          listing: { select: { make: true, model: true } },
        },
        take: 100,
      });
      for (const tx of stuckScan) {
        // Atomic CAS: only flip if still PENDING_CLAUDE, so two overlapping
        // runs can't both alert. The flip itself is the idempotency guard.
        const claim = await this.prisma.transaction.updateMany({
          where: { id: tx.id, dealerVerificationStatus: 'PENDING_CLAUDE' },
          data: { dealerVerificationStatus: 'PENDING_ADMIN_REVIEW' },
        });
        if (claim.count === 0) continue;
        await this.prisma.adminAlert.create({
          data: {
            type: 'DEALER_VERIFICATION_NEEDS_REVIEW',
            referenceId: tx.id,
            urgent: true,
            context:
              `Firearm verification ${tx.id.slice(-8).toUpperCase()} ` +
              `(${[tx.listing.make, tx.listing.model].filter(Boolean).join(' ') || 'firearm'}) ` +
              `stalled mid-scan (Claude call never completed) and was moved to ` +
              `manual review — buyer's payment is HELD. Decide it from the dossier.`,
          },
        });
      }

      if (overdue.length > 0 || stuckScan.length > 0) {
        this.logger.log(
          `Dealer-verification ageing: ${overdue.length} overdue review(s), ${stuckScan.length} stalled scan(s)`,
        );
      }
    } catch (err) {
      this.logger.error(
        `dealerVerificationAgeingSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('dealer-verification-ageing');
    }
  }

  // ─── Cron watchdog ──────────────────────────────────────────────
  // The health dashboard's cron-freshness check is PULL-only — it computes
  // stale/ok solely when an admin opens /admin/health. If a monitored sweep
  // dies (scheduler wedged, a cron hung behind a re-entrancy guard, pm2 in a
  // half-restart), auto-refunds / auction finalisation / payout reconciliation
  // silently stop and nobody is told. This pass PUSHES: every 15 min it reuses
  // AdminHealthService.cronStatuses() and raises a deduped CRON_STALE alert per
  // stale cron. It catches hung/dropped crons that stopped heartbeating — NOT
  // whole-process death (a dead Node can't run its own watchdog); pm2 + the
  // external /api/health/crons probe are the outer layer, and the alert copy
  // says so. 'never'-status rows (not yet run since deploy) are skipped, and
  // the whole pass no-ops during a startup grace window so a fresh restart
  // can't false-alarm before fast crons fire their first heartbeat.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cronWatchdog() {
    const STARTUP_GRACE_MS = 15 * 60 * 1000;
    try {
      if (Date.now() - this.bootAt.getTime() < STARTUP_GRACE_MS) return;
      const statuses = await this.health.cronStatuses();
      const stale = statuses.filter((c) => c.status === 'stale');
      for (const c of stale) {
        const existing = await this.prisma.adminAlert.count({
          where: { type: 'CRON_STALE', referenceId: c.name, resolved: false },
        });
        if (existing > 0) continue;
        const lastRun = c.lastRunAt
          ? c.lastRunAt.toISOString()
          : 'never (since restart)';
        await this.prisma.adminAlert.create({
          data: {
            type: 'CRON_STALE',
            referenceId: c.name,
            urgent: true,
            context:
              `Scheduled job "${c.name}" (${c.schedule}) has not run since ${lastRun} — ` +
              `it is overdue by 3× its interval. The job may be hung or the scheduler is ` +
              `down; time-sensitive automation it drives has stopped. Check pm2 + server ` +
              `logs. (Whole-process death is caught by pm2 / the external health probe, ` +
              `not this in-process watchdog.) Fires once per job until resolved.`,
          },
        });
        this.logger.error(`CRON_STALE alert raised for "${c.name}"`);
      }
    } catch (err) {
      this.logger.warn(`cronWatchdog failed: ${(err as Error).message}`);
    } finally {
      await this.recordCronRun('cron-watchdog');
    }
  }

  // ─── Accept-deadline escalation (TOK-7 Phase 2) ─────────────────
  // Every 10 minutes find transactions where the 48h accept window has
  // expired and the seller hasn't accepted or rejected. Flips
  // acceptEscalatedAt and notifies admins via the inbox + raises an
  // AdminAlert. No auto-refund — admin decides per case.
  //
  // 10-min cadence gives buyers a tight feedback loop after the seller
  // misses the deadline (vs the hourly dispatch SLA where the human
  // doesn't perceive a 60-min difference). Query is one indexed scan;
  // negligible DB load.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async acceptEscalationSweep() {
    try {
      const r = await this.transactions.escalateStaleAccepts();
      if (r.escalated > 0) {
        this.logger.log(
          `Accept-escalation: ${r.escalated} of ${r.scanned} flipped to escalated`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Accept-escalation sweep failed: ${(err as Error).message}`,
      );
    }
    await this.recordCronRun('accept-escalation');
  }

  // ─── Credit-balance poll ───────────────────────────────────────
  // Every 15 minutes, fetch every monitored external service's
  // balance, write a CreditSnapshot row, and fire an alert if any
  // service has dropped under its operator-configured threshold.
  //
  // Why poll instead of webhook:
  //   - None of these services push balance updates. We have to ask.
  //   - 15 min is the right cadence — fast enough that the operator
  //     finds out before a sustained burst eats the buffer, slow
  //     enough that we're not hammering 5 external APIs every minute.
  //
  // Failure modes are handled inside adminCredits.fetchAll() — the
  // method never throws and never blocks. Every result is written
  // (even errors — they appear as rows with balance=null + error
  // populated, which keeps the trend chart honest about gaps).
  // Raw 15-min cron expression — @nestjs/schedule's CronExpression enum
  // doesn't ship EVERY_15_MINUTES (it jumps from EVERY_10 to EVERY_30).
  @Cron('0 */15 * * * *')
  async pollCreditBalances() {
    let results: Awaited<ReturnType<typeof this.adminCredits.fetchAll>> = [];
    try {
      results = await this.adminCredits.fetchAll();
    } catch (err) {
      this.logger.error(
        `pollCreditBalances: fetchAll threw (shouldn't happen): ${(err as Error).message}`,
      );
      await this.recordCronRun('credit-poll');
      return;
    }

    // Write a snapshot row for every result — even errored ones, so
    // the chart shows gaps rather than silently dropping points.
    for (const r of results) {
      try {
        await this.prisma.creditSnapshot.create({
          data: {
            service: r.service,
            balance: r.balance,
            unit: r.unit,
            metadata: r.metadata as object | undefined,
            error: r.error,
            fetchedAt: r.fetchedAt,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to write CreditSnapshot for ${r.service}: ${(err as Error).message}`,
        );
      }
    }

    // Check each result against its threshold. Failures here are
    // logged but never abort the loop — one borked service's alert
    // path must not stop the others from being checked.
    for (const r of results) {
      if (r.balance == null) continue; // no fresh balance → no alert
      try {
        await this.checkCreditThreshold(r.service, r.balance, r.unit ?? '');
      } catch (err) {
        this.logger.warn(
          `Credit threshold check for ${r.service} failed: ${(err as Error).message}`,
        );
      }
    }

    await this.recordCronRun('credit-poll');
  }

  // Check the latest balance against the operator-configured threshold
  // for one service. Fires alerts (with 6h dedup) when crossed.
  //
  // Direction (audit fix 2026-07-20): for every service except Anthropic
  // the number is a REMAINING BALANCE — alert when it drops BELOW the
  // threshold. Anthropic's number is 24h SPEND (USD) — alert when it
  // rises ABOVE the threshold. The old code applied `balance <=
  // threshold` to both, so no Anthropic spend alert could ever fire
  // meaningfully. No schema change: the direction is derived from the
  // service name.
  private async checkCreditThreshold(
    service: string,
    balance: number,
    unit: string,
  ): Promise<void> {
    let threshold = await this.prisma.creditThreshold.findUnique({
      where: { service },
    });
    // No operator-configured row → materialise the built-in default into
    // a real row (it carries the alert-dedup timestamps). Previously the
    // defaults were display-only and the cron silently never alerted for
    // unconfigured services (audit fix 2026-07-20).
    if (!threshold) {
      const d = DEFAULT_THRESHOLDS[service];
      if (!d || (d.warn == null && d.alarm == null)) return;
      try {
        threshold = await this.prisma.creditThreshold.create({
          data: {
            service,
            warnThreshold: d.warn,
            alarmThreshold: d.alarm,
            enabled: true,
          },
        });
      } catch {
        // Unique race with a concurrent write — re-read.
        threshold = await this.prisma.creditThreshold.findUnique({
          where: { service },
        });
      }
    }
    if (!threshold || !threshold.enabled) return;

    // spend-style services: crossing = value ABOVE threshold.
    const spendStyle = service === 'anthropic';
    const crossed = (value: number, limit: number) =>
      spendStyle ? value >= limit : value <= limit;

    const now = new Date();

    // Alarm comes first — if both are tripped, the alarm path also
    // serves as the warn path (no point sending two emails).
    if (
      threshold.alarmThreshold != null &&
      crossed(balance, threshold.alarmThreshold)
    ) {
      const lastAlarm = threshold.lastAlarmAlertAt;
      // Already alerted for this crossing? Stay quiet until it recovers, or
      // until the weekly floor.
      if (
        !lastAlarm ||
        now.getTime() - lastAlarm.getTime() >= CREDIT_ALERT_REPEAT_FLOOR_MS
      ) {
        await this.fanOutCreditAlert(
          service,
          balance,
          unit,
          'alarm',
          threshold.alarmThreshold,
        );
        await this.prisma.creditThreshold.update({
          where: { service },
          data: { lastAlarmAlertAt: now },
        });
      }
      return;
    }

    // Healthy again — clear the stamps so the NEXT dip alerts straight away
    // instead of being swallowed by a stale timer. Without this the edge
    // trigger degenerates back into a timer.
    if (
      (threshold.warnThreshold == null ||
        !crossed(balance, threshold.warnThreshold)) &&
      (threshold.lastWarnAlertAt || threshold.lastAlarmAlertAt)
    ) {
      await this.prisma.creditThreshold.update({
        where: { service },
        data: { lastWarnAlertAt: null, lastAlarmAlertAt: null },
      });
      return;
    }

    if (
      threshold.warnThreshold != null &&
      crossed(balance, threshold.warnThreshold)
    ) {
      const lastWarn = threshold.lastWarnAlertAt;
      if (
        !lastWarn ||
        now.getTime() - lastWarn.getTime() >= CREDIT_ALERT_REPEAT_FLOOR_MS
      ) {
        await this.fanOutCreditAlert(
          service,
          balance,
          unit,
          'warn',
          threshold.warnThreshold,
        );
        await this.prisma.creditThreshold.update({
          where: { service },
          data: { lastWarnAlertAt: now },
        });
      }
    }
  }

  // Fan an alert out to every active superadmin. Resolves the SUPERADMIN
  // AdminUser rows, joins to their linked User row for phone (when
  // available), emails everyone, and SMSes everyone (alarm only).
  // Best-effort — individual send failures are logged not thrown.
  private async fanOutCreditAlert(
    service: string,
    balance: number,
    unit: string,
    severity: 'warn' | 'alarm',
    threshold: number,
  ): Promise<void> {
    const admins = await this.prisma.adminUser.findMany({
      where: { isActive: true, role: 'SUPERADMIN' },
      select: { id: true, clerkId: true, email: true, firstName: true },
    });
    if (admins.length === 0) {
      this.logger.warn(
        `Credit alert (${service} ${severity}) but no active SUPERADMIN to notify`,
      );
      return;
    }

    const clerkIds = admins.map((a) => a.clerkId).filter(Boolean) as string[];
    const linkedUsers = clerkIds.length
      ? await this.prisma.user.findMany({
          where: { clerkId: { in: clerkIds } },
          select: {
            clerkId: true,
            email: true,
            phone: true,
            firstName: true,
          },
        })
      : [];
    const userByClerkId = new Map(
      linkedUsers.map((u) => [u.clerkId, u] as const),
    );

    for (const admin of admins) {
      const linked = admin.clerkId
        ? userByClerkId.get(admin.clerkId)
        : undefined;
      const email = linked?.email ?? admin.email;
      const phone = linked?.phone ?? null;
      const name = linked?.firstName ?? admin.firstName ?? 'Admin';

      try {
        const smsBody = await this.notifications.creditAlert({
          adminEmail: email,
          adminName: name,
          service,
          balance,
          unit,
          severity,
          threshold,
        });
        // SMS only for alarms — warn is email-only by design.
        if (severity === 'alarm' && phone) {
          await this.sms.sendSms({
            to: phone,
            message: smsBody,
            reference: `credit-${service}-${severity}-${admin.id}`,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Credit alert send to admin ${admin.id} failed: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Credit alert dispatched: service=${service} severity=${severity} balance=${balance}${unit ? ' ' + unit : ''} threshold=${threshold} admins=${admins.length}`,
    );
  }

  // ─── Insights rollups (Phase 2) ─────────────────────────────────────
  // Nightly at 02:00 — aggregate the last ~2 days of raw UserEvent +
  // LoginEvent into DailyUserStats (per-user daily) and HourlyPlatformStats
  // (platform activity by hour-of-clock). A 2-day lookback + idempotent
  // ON CONFLICT upserts means late-arriving events and day boundaries are
  // never missed and a re-run just recomputes the same buckets. Raw events
  // stay the source of truth; these rollups survive the 12-month prune so
  // aggregate history is permanent (privacy policy §9).
  @Cron('0 2 * * *')
  async rollupInsights(): Promise<void> {
    if (this.statsRollupRunning) return;
    this.statsRollupRunning = true;
    const to = new Date();
    const from = new Date(to.getTime() - 2 * 24 * 60 * 60 * 1000);
    try {
      // 0) Resolve hot-path events that only carried a raw clerkId to a
      //    User.id, so they count in the per-user rollup. Deliberately NOT
      //    windowed: if the cron misses a night, older unresolved rows are
      //    still swept up (cheap — the predicate matches few rows).
      await this.prisma.$executeRaw`
        UPDATE "UserEvent" e SET "userId" = u.id
        FROM "User" u
        WHERE e."userId" IS NULL AND e."clerkId" IS NOT NULL
          AND u."clerkId" = e."clerkId"`;

      // 1) Per-user daily activity.
      await this.prisma.$executeRaw`
        INSERT INTO "DailyUserStats"
          ("id","day","userId","pageViews","listingViews","searches","offers","bids","events")
        SELECT gen_random_uuid()::text, date_trunc('day', "createdAt")::date, "userId",
          COUNT(*) FILTER (WHERE "eventType" = 'page_view'),
          COUNT(*) FILTER (WHERE "eventType" = 'listing_view'),
          COUNT(*) FILTER (WHERE "eventType" = 'search'),
          COUNT(*) FILTER (WHERE "eventType" = 'offer_placed'),
          COUNT(*) FILTER (WHERE "eventType" = 'bid_placed'),
          COUNT(*)
        FROM "UserEvent"
        WHERE "userId" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 2, 3
        ON CONFLICT ("day","userId") DO UPDATE SET
          "pageViews" = EXCLUDED."pageViews", "listingViews" = EXCLUDED."listingViews",
          "searches" = EXCLUDED."searches", "offers" = EXCLUDED."offers",
          "bids" = EXCLUDED."bids", "events" = EXCLUDED."events"`;

      // 2) Per-user daily logins (from LoginEvent).
      await this.prisma.$executeRaw`
        INSERT INTO "DailyUserStats" ("id","day","userId","logins")
        SELECT gen_random_uuid()::text, date_trunc('day', "startedAt")::date, "userId", COUNT(*)
        FROM "LoginEvent"
        WHERE "startedAt" >= ${from} AND "startedAt" < ${to}
        GROUP BY 2, 3
        ON CONFLICT ("day","userId") DO UPDATE SET "logins" = EXCLUDED."logins"`;

      // 3) Platform activity by hour + event type (drives the heatmaps).
      await this.prisma.$executeRaw`
        INSERT INTO "HourlyPlatformStats" ("id","hour","eventType","count","uniqueUsers")
        SELECT gen_random_uuid()::text, date_trunc('hour', "createdAt"), "eventType",
          COUNT(*), COUNT(DISTINCT COALESCE("userId","clerkId","deviceId"))
        FROM "UserEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 2, 3
        ON CONFLICT ("hour","eventType") DO UPDATE SET
          "count" = EXCLUDED."count", "uniqueUsers" = EXCLUDED."uniqueUsers"`;
    } catch (err) {
      this.logger.error(`rollupInsights failed: ${(err as Error).message}`);
    } finally {
      this.statsRollupRunning = false;
      await this.recordCronRun('stats-rollup');
    }
  }

  // Weekly — prune raw behavioural events older than 12 months (privacy
  // policy §9). Rollups above already captured them, so aggregate history
  // survives. Batched delete so a large purge can't lock the table.
  @Cron(CronExpression.EVERY_WEEK)
  async pruneRawEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    try {
      let total = 0;
      for (let i = 0; i < 100; i++) {
        const batch = await this.prisma.userEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: 5000,
        });
        if (batch.length === 0) break;
        const del = await this.prisma.userEvent.deleteMany({
          where: { id: { in: batch.map((b) => b.id) } },
        });
        total += del.count;
        if (batch.length < 5000) break;
      }
      // LoginEvent is per-user behavioural data too — same 12-month raw
      // retention as UserEvent (privacy policy §9). DailyUserStats keeps the
      // aggregate login counts forever. Volume is tiny → single deleteMany.
      const logins = await this.prisma.loginEvent.deleteMany({
        where: { startedAt: { lt: cutoff } },
      });
      total += logins.count;
      if (total > 0) this.logger.log(`Pruned ${total} raw events older than 12 months`);
    } catch (err) {
      this.logger.warn(`pruneRawEvents failed: ${(err as Error).message}`);
    } finally {
      await this.recordCronRun('event-prune');
    }
  }
}
