import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffersService } from '../offers/offers.service';
import { SwapProposalsService } from '../swaps/swap-proposals.service';
import { SwapFundingService } from '../swaps/swap-funding.service';
import { AuctionsService } from '../auctions/auctions.service';
import {
  FeaturedService,
  FEATURED_UNPAID_MAX_MS,
} from '../featured/featured.service';
import { KycService } from '../kyc/kyc.service';
import { TrackingService } from '../shipping/tracking.service';
import { DispatchSlaService } from '../payments/dispatch-sla.service';
import { ExperienceSlaService } from '../payments/experience-sla.service';
import { TransactionsService } from '../payments/transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeOrderRollupStatus } from '../orders/order-math';
import { AdminCreditsService } from '../admin/admin-credits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { PushService } from '../push/push.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { SavedSearchesService } from '../saved-searches/saved-searches.service';
import { DealsService } from '../deals/deals.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { NotificationCategory } from '@prisma/client';

// Threshold-alert dedup window. Once we've fired an alert at any
// severity for a given service, we won't fire ANOTHER alert at the
// same severity for that service until this window elapses. Stops
// the 15-min cron from spamming the operator while the balance
// hovers just under the line.
const CREDIT_ALERT_DEDUP_MS = 6 * 60 * 60 * 1000; // 6 hours

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  // DD-4 — re-entrancy guard: @Cron(EVERY_MINUTE) re-fires on tick even if the
  // previous invocation is still running, so a >60s sweep could overlap itself.
  // The go-live transitions are CAS-guarded (idempotent), but this also avoids
  // redundant work + duplicate drop pushes.
  private dealDropRunning = false;

  constructor(
    private readonly offersService: OffersService,
    private readonly swapProposals: SwapProposalsService,
    private readonly swapFunding: SwapFundingService,
    private readonly auctionsService: AuctionsService,
    private readonly featured: FeaturedService,
    private readonly kycService: KycService,
    private readonly trackingService: TrackingService,
    private readonly dispatchSla: DispatchSlaService,
    private readonly experienceSla: ExperienceSlaService,
    private readonly transactions: TransactionsService,
    private readonly prisma: PrismaService,
    private readonly adminCredits: AdminCreditsService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly push: PushService,
    private readonly subscriptions: SubscriptionsService,
    private readonly zohoBooks: ZohoBooksService,
    private readonly savedSearches: SavedSearchesService,
    private readonly deals: DealsService,
    private readonly settings: SettingsService,
  ) {}

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

  // ─── Featured-slot tick ─────────────────────────────────────────
  // Runs every minute. Five jobs in one pass to keep latency tight:
  //   1. Open SCHEDULED pre-auctions for slots whose featuredUntil
  //      is within scheduledAuctionSec of now AND no auction is open
  //   2. Close OPEN auctions whose closesAt has passed
  //   3. Expire bind windows that have elapsed without a listing
  //      being bound (cascade to runner-up)
  //   4. Expire featuredUntil that have ticked past (frees the slot
  //      — the parallel SCHEDULED auction should have just closed
  //      and promoted the next occupant)
  //   5. Open AD_HOC auctions for any VACANT slot that doesn't have
  //      a currentAuction (catches cold-start + post-sale gaps)
  // AUDIT M14 + M34 — outer try/catch so one bad slot doesn't poison
  // every subsequent feature-tick pass; `recordCronRun('featured-tick')`
  // in finally so the admin health dashboard sees it heartbeat.
  // Without these guards a persistent error on a single slot would
  // re-throw every minute, blocking ALL featured-slot lifecycle
  // processing AND leaving the operator blind to the stall (the
  // dashboard would show "never run").
  @Cron(CronExpression.EVERY_MINUTE)
  async featuredTick() {
    try {
      await this.featuredTickImpl();
    } catch (err) {
      this.logger.error(
        `featuredTick failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('featured-tick');
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

  private async featuredTickImpl() {
    const now = new Date();
    const cfg = await this.featured.getConfig();

    // 0) Detect SOLD listings still bound to a slot — free the slot
    //    so an ad-hoc auction can open. Catches both the "listing
    //    moved to PAYMENT_PENDING/SOLD/COMPLETED" case and any case
    //    where the listing was cancelled/paused while featured. Done
    //    in the cron (rather than via a TransactionsService →
    //    FeaturedService call) to avoid a cross-module forwardRef.
    const featuredButUnavailable = await this.prisma.featuredSlot.findMany({
      where: {
        status: 'OCCUPIED',
        currentListing: {
          status: { notIn: ['ACTIVE'] },
        },
      },
      select: { id: true, currentListingId: true },
    });
    for (const s of featuredButUnavailable) {
      if (s.currentListingId) {
        await this.featured.releaseSoldListing(s.currentListingId);
      }
    }

    // 1) Close auctions whose timer has run out. Only auctions with
    //    closesAt SET are eligible — closesAt=null means we're still
    //    waiting for the first bid to start the timer.
    const dueToClose = await this.prisma.featuredAuction.findMany({
      where: {
        status: 'OPEN',
        closesAt: { not: null, lte: now },
      },
      select: { id: true },
    });
    for (const a of dueToClose) {
      await this.featured.closeAuction(a.id);
    }

    // 2) Expire bind windows (winner had 15min to pick a listing).
    //    P1.2 guard — do NOT cascade a winner who is mid-EFT-payment:
    //    (a) unpaid with a live paymentPayByAt = they've committed and
    //        have until the deadline to pay;
    //    (b) PAID but not yet bound (auto-bind failed, e.g. the pending
    //        listing sold while the money was in flight) = they've paid
    //        for the slot and must be able to re-pick; only admin
    //        force-evict frees such a slot.
    //
    //    Review fix (re-arm squat): (a) shields an UNPAID winner while
    //    paymentPayByAt is live, but re-binding re-arms that deadline with
    //    no cap — a winner could hold a homepage slot for free forever.
    //    Cap the TOTAL unpaid hold at the auction's closedAt + one pay
    //    window (+ bind window slack): past FEATURED_UNPAID_MAX_MS the slot
    //    is forfeited regardless of a re-armed paymentPayByAt, because
    //    closedAt never advances for the original winner.
    const bindCutoff = new Date(now.getTime() - cfg.bindWindowSec * 1000);
    const unpaidHardCutoff = new Date(
      now.getTime() - (cfg.bindWindowSec * 1000 + FEATURED_UNPAID_MAX_MS),
    );
    const expiredBinds = await this.prisma.featuredSlot.findMany({
      where: {
        status: 'BIND_WINDOW',
        currentAuction: { closedAt: { lte: bindCutoff } },
        OR: [
          // Normal path: window lapsed and not shielded by paid/live-EFT.
          {
            NOT: {
              currentAuction: {
                winningBid: {
                  OR: [
                    { paidAt: { not: null } },
                    { paidAt: null, paymentPayByAt: { gt: now } },
                  ],
                },
              },
            },
          },
          // Absolute cap: an UNPAID winner past the hard cutoff is forfeited
          // even if they keep re-arming paymentPayByAt (paid winners are
          // never touched here — they need admin force-evict).
          {
            currentAuction: {
              closedAt: { lte: unpaidHardCutoff },
              winningBid: { paidAt: null },
            },
          },
        ],
      },
      select: { id: true },
    });
    for (const s of expiredBinds) {
      await this.featured.expireBindWindow(s.id);
    }

    // 3) Expire featuredUntil that have elapsed (occupant's time up).
    const expiredFeatured = await this.prisma.featuredSlot.findMany({
      where: { status: 'OCCUPIED', featuredUntil: { lte: now } },
      select: { id: true },
    });
    for (const s of expiredFeatured) {
      await this.featured.expireFeatured(s.id);
    }

    // 4) Open auctions on any slot that's VACANT + auctionless.
    //    Auctions sit at closesAt=null waiting for the first bid.
    const vacantNoAuction = await this.prisma.featuredSlot.findMany({
      where: { status: 'VACANT', currentAuctionId: null },
      select: { id: true },
    });
    for (const s of vacantNoAuction) {
      await this.featured.openAuction(s.id);
    }

    if (
      dueToClose.length +
        expiredBinds.length +
        expiredFeatured.length +
        vacantNoAuction.length >
      0
    ) {
      this.logger.log(
        `featured tick: closed=${dueToClose.length} bindExpired=${expiredBinds.length} featuredExpired=${expiredFeatured.length} opened=${vacantNoAuction.length}`,
      );
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
    } finally {
      await this.recordCronRun('offer-expire');
    }
  }

  // P1.1 — every 10 minutes: fail subscription charges whose 24h EFT
  // window lapsed unpaid, send the 3-days-out renewal reminder, and
  // downgrade expired prepaid periods to FREE. All three passes are
  // idempotent (atomic WHERE re-checks inside the service).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async subscriptionSweep() {
    this.logger.debug('Running subscription sweep cron');
    try {
      await this.subscriptions.sweep();
    } catch (err) {
      this.logger.error(
        `subscriptionSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('subscription-sweep');
    }
  }

  // Run every 10 minutes — expire pending/countered swap proposals past
  // their TTL (48h propose / 24h counter). Mirrors offer expiry.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireSwapProposals() {
    this.logger.debug('Running swap-proposal expiry cron');
    try {
      await this.swapProposals.expireStale();
    } catch (err) {
      this.logger.error(
        `expireSwapProposals failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('swap-proposal-expire');
    }
  }

  // Run every 10 minutes — sweep swaps whose funding deadline lapsed without
  // both sides paying: cancel, restock both listings, reimburse any side that
  // did pay (synthetic refund → FNB batch).
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepSwapFunding() {
    this.logger.debug('Running swap funding sweep cron');
    try {
      await this.swapFunding.sweepExpiredFunding();
    } catch (err) {
      this.logger.error(
        `sweepSwapFunding failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('swap-funding-sweep');
    }
  }

  // P1.3 — hourly retry for swap leg-fee Zoho receipts that failed at
  // completion (createSwapFeeReceipts is idempotent per side, so a re-fire
  // can only fill a missing receipt). Keeps Books whole without an admin
  // clicking a retry button.
  @Cron(CronExpression.EVERY_HOUR)
  async retrySwapFeeReceipts() {
    try {
      await this.zohoBooks.retryMissingSwapFeeReceipts();
    } catch (err) {
      this.logger.error(
        `retrySwapFeeReceipts failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('swap-fee-receipt-retry');
    }
  }

  // Re-drive swaps wedged at LOCKED (crash between the lock write and the
  // IN_TRANSIT flip). Runs every 5 min so a stranded fully-funded swap is
  // picked up promptly, not left for the admin to notice by hand.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepStalledLockedSwaps() {
    this.logger.debug('Running swap LOCKED re-drive sweep');
    try {
      await this.swapFunding.sweepStalledLockedSwaps();
    } catch (err) {
      this.logger.error(
        `sweepStalledLockedSwaps failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('swap-locked-redrive');
    }
  }

  // Run hourly — flag LOCKED+booked swaps where a party never dropped their
  // parcel (booked but uncollected past the SLA) → DISPUTED for admin review.
  @Cron(CronExpression.EVERY_HOUR)
  async sweepStalledSwapShipping() {
    this.logger.debug('Running swap shipping SLA sweep');
    try {
      await this.swapFunding.sweepStalledSwapShipping();
    } catch (err) {
      this.logger.error(
        `sweepStalledSwapShipping failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('swap-shipping-sla');
    }
  }

  // Run hourly — AWAITING_VERIFICATION swaps past their 48h window with no
  // dispute → release held cash to the recipient + COMPLETED (S5).
  @Cron(CronExpression.EVERY_HOUR)
  async sweepSwapVerification() {
    this.logger.debug('Running swap verification-window sweep');
    try {
      await this.swapFunding.sweepSwapVerification();
    } catch (err) {
      this.logger.error(
        `sweepSwapVerification failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('swap-verification-sweep');
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
    await this.recordCronRun('dispatch-sla');
  }

  // EXP-E4 — experience (hunting-package) SLA sweep. The nudge/alert twin of
  // the dispatch SLA for future-dated ON_SITE_SERVICE bookings (invisible to
  // every courier/DT/collection sweep by design). Four idempotent passes in
  // one call: outfitter booking-confirm nudge → escalate-to-admin past the 48h
  // window; confirmed-booking pre-event reminder; post-event buyer confirm
  // nudge → admin alert if still HELD after the 7-day window. NO pass moves
  // money, releases, or refunds. Hourly (like dispatchSlaSweep — the human
  // doesn't perceive a sub-hour difference); heartbeat in finally.
  @Cron(CronExpression.EVERY_HOUR)
  async experienceSlaSweep() {
    try {
      const r = await this.experienceSla.experienceSlaSweep();
      if (
        r.bookingNudged > 0 ||
        r.bookingEscalated > 0 ||
        r.preEventReminded > 0 ||
        r.postEventNudged > 0 ||
        r.postEventAlerted > 0
      ) {
        this.logger.log(
          `Experience SLA sweep: booking nudged ${r.bookingNudged}, escalated ${r.bookingEscalated}, ` +
            `pre-event reminded ${r.preEventReminded}, post-event nudged ${r.postEventNudged}, alerted ${r.postEventAlerted}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `experienceSlaSweep failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('experience-sla');
    }
  }

  // P5.3 — stuck HELD funds: courier orders delivered >72h ago that the buyer
  // never confirmed. Raises a one-shot admin alert (NO auto-release — operator
  // decision); the admin reviews + manually releases from the dossier. Hourly,
  // heartbeat in finally.
  @Cron(CronExpression.EVERY_HOUR)
  async stuckHeldFundsSweep() {
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
  // NOTE on Anthropic: for that service the "balance" is SPEND (USD
  // over 24h) not balance-remaining, so the comparison is conceptually
  // "are we OVER the limit?". For now we apply the same `balance <=
  // threshold` rule — the operator should set Anthropic's thresholds
  // to NEGATIVE numbers if they want spend-cap behaviour, or leave
  // them null (which the next clause handles). A follow-up could add
  // a `direction` column to CreditThreshold; until then, the operator
  // can leave Anthropic thresholds unset and rely on the trend chart.
  private async checkCreditThreshold(
    service: string,
    balance: number,
    unit: string,
  ): Promise<void> {
    const threshold = await this.prisma.creditThreshold.findUnique({
      where: { service },
    });
    if (!threshold || !threshold.enabled) return;

    const now = new Date();

    // Alarm comes first — if both are tripped, the alarm path also
    // serves as the warn path (no point sending two emails).
    if (
      threshold.alarmThreshold != null &&
      balance <= threshold.alarmThreshold
    ) {
      const lastAlarm = threshold.lastAlarmAlertAt;
      if (
        !lastAlarm ||
        now.getTime() - lastAlarm.getTime() >= CREDIT_ALERT_DEDUP_MS
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

    if (threshold.warnThreshold != null && balance <= threshold.warnThreshold) {
      const lastWarn = threshold.lastWarnAlertAt;
      if (
        !lastWarn ||
        now.getTime() - lastWarn.getTime() >= CREDIT_ALERT_DEDUP_MS
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
}
