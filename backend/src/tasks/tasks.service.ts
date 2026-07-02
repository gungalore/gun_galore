import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffersService } from '../offers/offers.service';
import { SwapProposalsService } from '../swaps/swap-proposals.service';
import { SwapFundingService } from '../swaps/swap-funding.service';
import { AuctionsService } from '../auctions/auctions.service';
import { RafflesService } from '../raffles/raffles.service';
import {
  FeaturedService,
  FEATURED_UNPAID_MAX_MS,
} from '../featured/featured.service';
import { KycService } from '../kyc/kyc.service';
import { TrackingService } from '../shipping/tracking.service';
import { DispatchSlaService } from '../payments/dispatch-sla.service';
import { TransactionsService } from '../payments/transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreditsService } from '../admin/admin-credits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { PushService } from '../push/push.service';
import { ManualPaymentsService } from '../manual-payments/manual-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';

// Threshold-alert dedup window. Once we've fired an alert at any
// severity for a given service, we won't fire ANOTHER alert at the
// same severity for that service until this window elapses. Stops
// the 15-min cron from spamming the operator while the balance
// hovers just under the line.
const CREDIT_ALERT_DEDUP_MS = 6 * 60 * 60 * 1000; // 6 hours

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly offersService: OffersService,
    private readonly swapProposals: SwapProposalsService,
    private readonly swapFunding: SwapFundingService,
    private readonly auctionsService: AuctionsService,
    private readonly rafflesService: RafflesService,
    private readonly featured: FeaturedService,
    private readonly kycService: KycService,
    private readonly trackingService: TrackingService,
    private readonly dispatchSla: DispatchSlaService,
    private readonly transactions: TransactionsService,
    private readonly prisma: PrismaService,
    private readonly adminCredits: AdminCreditsService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly push: PushService,
    private readonly manualPayments: ManualPaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly zohoBooks: ZohoBooksService,
  ) {}

  // ─── Manual EFT — inContact inbox scan ───────────────────────────
  // Every 10 min: read pop@gungalore.co.za for new FNB inContact credit
  // alerts, match them to awaiting orders by reference + amount, and set
  // manualDetectedAt (PROVISIONAL — stops the 1-hour freeze timer). The
  // seller is NOT notified here; the daily statement upload is the
  // authoritative gate that confirms payment + triggers dispatch.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async scanInContactInbox() {
    try {
      await this.manualPayments.scanInbox();
    } catch (err) {
      this.logger.error(
        `scanInContactInbox failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('incontact-scan');
    }
  }

  // ─── Payout reminder — 09:00 SAST daily ──────────────────────────
  // If any seller payouts / buyer refunds are owed (not yet batched or paid
  // out), raise a once-a-day admin alert so the operator runs the FNB bulk
  // payment. Never pays automatically — the operator downloads + authorises.
  @Cron('0 0 9 * * *', { timeZone: 'Africa/Johannesburg' }) // 09:00 SAST
  async payoutDueReminder() {
    try {
      const { payouts, refunds } = await this.manualPayments.getPayoutsDue();
      const count = payouts.length + refunds.length;
      if (count === 0) return;
      const totalCents =
        payouts.reduce((s, p) => s + p.sellerPayout, 0) +
        refunds.reduce((s, r) => s + r.buyerTotal, 0);
      const rand = `R${(totalCents / 100).toFixed(2)}`;
      // One alert per day (date-stamped ref) — skip if already raised today.
      const referenceId = `payouts-${new Date().toISOString().slice(0, 10)}`;
      const existing = await this.prisma.adminAlert.findFirst({
        where: { referenceId },
        select: { id: true },
      });
      if (existing) return;
      await this.prisma.adminAlert.create({
        data: {
          type: 'PAYOUTS_DUE',
          referenceId,
          urgent: false,
          context: `${count} seller payout${count === 1 ? '' : 's'}/refund${count === 1 ? '' : 's'} totalling ${rand} are due. Open Admin → Manual payments to freeze + download the FNB batch, pay it, then mark the batch paid.`,
        },
      });
      this.logger.log(`Payout reminder raised: ${count} due, ${rand}`);
    } catch (err) {
      this.logger.error(
        `payoutDueReminder failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('payout-reminder');
    }
  }

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

  // ─── Manual EFT — freeze expiry + payment reminders ──────────────
  // Every 5 min: (1) release listings whose 24-hour pay-by window lapsed
  // with no payment detected, SOFT-cancelling the stale order (the row
  // is kept so a late statement payment is still recoverable); (2) fire
  // the 12-hours-left and 1-hour-left "time to pay" SMS reminders.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async manualPaymentFreezeSweep() {
    const now = new Date();
    try {
      // (1) Expire un-paid, un-detected orders past their pay-by time.
      const expired = await this.prisma.transaction.findMany({
        where: {
          paymentStatus: 'HELD',
          paidAt: null,
          manualDetectedAt: null,
          manualVerifiedAt: null,
          manualCancelledAt: null,
          manualPayByAt: { not: null, lte: now },
        },
        select: {
          id: true,
          listingId: true,
          orderReference: true,
          listing: { select: { listingType: true } },
        },
        take: 100,
      });
      for (const tx of expired) {
        try {
          // Release the listing back to ACTIVE, but SOFT-CANCEL the order
          // (keep the row) rather than deleting it. If the buyer actually
          // paid and inContact just never fired, the later FNB statement
          // still carries orderReference — the reconciler can then find
          // this row and surface it as "paid after expiry" for a refund /
          // re-fulfil decision instead of the payment being orphaned.
          // P0.2 — an ENDED AUCTION must release to EXPIRED, not ACTIVE:
          // finalizeAuction already ran (endedAt set), so an ACTIVE ended
          // auction would be a zombie on browse that can never re-finalize.
          await this.prisma.$transaction([
            this.prisma.listing.updateMany({
              where: { id: tx.listingId, status: 'PAYMENT_PENDING' },
              data: {
                status:
                  tx.listing?.listingType === 'AUCTION' ? 'EXPIRED' : 'ACTIVE',
              },
            }),
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: { manualCancelledAt: now },
            }),
          ]);
          this.logger.log(
            `Manual EFT freeze expired for order ${tx.orderReference ?? tx.id} — listing ${tx.listingId} released, order soft-cancelled`,
          );
          // P0.2 review fix — an expired AUCTION win here means the winner
          // STARTED checkout but never paid; tell the seller (the other
          // unpaid-winner path notifies via sweepUnpaidWins).
          if (tx.listing?.listingType === 'AUCTION') {
            void this.auctionsService.notifyWinnerUnpaid(tx.listingId);
          }
        } catch (err) {
          this.logger.warn(
            `freeze-expire failed for ${tx.id}: ${(err as Error).message}`,
          );
        }
      }

      // (1b) Expire un-paid, un-detected multi-item ORDERS (Phase 8b) past
      // their pay-by window. ALL-OR-NOTHING: release every line's listing and
      // soft-cancel the whole order + all children in ONE transaction, so a
      // cart can never be left half-released (some lines free, some frozen).
      // Order children carry no manualPayByAt, so the per-tx sweep above never
      // touches them — this is the only path that expires an order.
      const expiredOrders = await this.prisma.order.findMany({
        where: {
          status: 'AWAITING_PAYMENT',
          paidAt: null,
          manualDetectedAt: null,
          manualCancelledAt: null,
          manualPayByAt: { not: null, lte: now },
        },
        select: {
          id: true,
          orderReference: true,
          transactions: { select: { id: true } },
          lineItems: {
            select: {
              listingId: true,
              quantity: true,
              listing: { select: { trackInventory: true } },
            },
          },
        },
        take: 50,
      });
      for (const order of expiredOrders) {
        try {
          await this.prisma.$transaction(async (txc) => {
            // COMPARE-AND-SET the order cancel FIRST. confirmManualOrder
            // stamps manualDetectedAt before paying any child, so if it has
            // started (or finished) this claim matches 0 rows and we touch
            // NOTHING — no racing restock of a SOLD listing, no reverting a
            // PAID order.
            const claim = await txc.order.updateMany({
              where: {
                id: order.id,
                status: 'AWAITING_PAYMENT',
                paidAt: null,
                manualDetectedAt: null,
                manualCancelledAt: null,
              },
              data: { manualCancelledAt: now, status: 'CANCELLED' },
            });
            if (claim.count === 0) return; // concurrently detected/paid
            // We won the claim ⇒ no child can be paid ⇒ every listing is
            // still reserved. Release each (legacy guarded on PAYMENT_PENDING,
            // mirroring the per-tx sweep; tracked gives units back).
            for (const li of order.lineItems) {
              if (li.listing.trackInventory) {
                await txc.listing.update({
                  where: { id: li.listingId },
                  data: {
                    status: 'ACTIVE',
                    quantityAvailable: { increment: li.quantity },
                    quantityReserved: { decrement: li.quantity },
                  },
                });
              } else {
                await txc.listing.updateMany({
                  where: { id: li.listingId, status: 'PAYMENT_PENDING' },
                  data: { status: 'ACTIVE' },
                });
              }
            }
            await txc.transaction.updateMany({
              where: { id: { in: order.transactions.map((t) => t.id) }, paidAt: null },
              data: { manualCancelledAt: now },
            });
          });
          this.logger.log(
            `Manual EFT freeze swept ORDER ${order.orderReference ?? order.id} (${order.lineItems.length} lines) — cancelled if still unclaimed`,
          );
        } catch (err) {
          this.logger.warn(
            `order freeze-expire failed for ${order.id}: ${(err as Error).message}`,
          );
        }
      }

      // (1c) Orphan reclaim (Phase 8b safety net). A cart checkout that died
      // between reserving a line and creating its Order — or a single-item
      // checkout that died between tx.create and the orderReference update —
      // leaves a never-paid HELD tx with NO orderId, NO orderReference, NO
      // gateway session and NO pay-by window: invisible to every other sweep,
      // its reserved listing stranded. Reclaim them (release listing + delete
      // tx). The filter is tight enough it can NEVER touch a live tx: a real
      // single-item manual tx has orderReference + manualPayByAt; a gateway tx
      // has peachCheckoutId; an order child has orderId; a paid/refunded tx
      // has paidAt; a SWOP leg has a swapId. The 15-min age floor protects an
      // in-flight same-request tx.
      //
      // swapId: null is LOAD-BEARING. A swap creates two ZERO-money Transaction
      // legs that carry NO orderId / orderReference / peachCheckoutId /
      // manualPayByAt / paidAt — they match every other orphan condition. Without
      // this guard the sweep would delete both legs + un-reserve both listings
      // ~15 min after every swap was agreed, orphaning the Swap parent. The legs'
      // lifecycle is owned by the swap flow (lock/book/ship in S3+), never here.
      const orphanCutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const orphans = await this.prisma.transaction.findMany({
        where: {
          paidAt: null,
          orderId: null,
          orderReference: null,
          peachCheckoutId: null,
          manualPayByAt: null,
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

      // (2) Payment reminders across the 24h window: a nudge when ≤12h
      // remain and a final one when ≤1h remains. Idempotent via the warn
      // timestamps. (The first touchpoint is the checkout screen itself.)
      const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
      const in1h = new Date(now.getTime() + 60 * 60 * 1000);
      await this.fireManualWarnings('manualWarn12hAt', in12h, '12 hours');
      await this.fireManualWarnings('manualWarn1hAt', in1h, '1 hour');
    } catch (err) {
      this.logger.error(
        `manualPaymentFreezeSweep failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('manual-freeze-sweep');
    }
  }

  // Fire a single payment-reminder tier. `field` is the idempotency
  // stamp; `before` is the upper bound on manualPayByAt (≤12h / ≤1h
  // out). Only un-detected, un-warned, still-pending orders qualify.
  private async fireManualWarnings(
    field: 'manualWarn12hAt' | 'manualWarn1hAt',
    before: Date,
    label: string,
  ) {
    const due = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'HELD',
        paidAt: null,
        manualDetectedAt: null,
        manualPayByAt: { not: null, lte: before, gt: new Date() },
        [field]: null,
      },
      select: { id: true, buyerId: true, orderReference: true, buyerTotal: true },
      take: 100,
    });
    for (const tx of due) {
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { [field]: new Date() },
        });
        const buyer = await this.prisma.user.findUnique({
          where: { id: tx.buyerId },
          select: { phone: true },
        });
        if (buyer?.phone) {
          await this.sms
            .sendSms({
              to: buyer.phone,
              message: `Gun Galore: ${label} left to EFT R${(tx.buyerTotal / 100).toFixed(2)} for order ${tx.orderReference ?? ''}. Use the order number as your payment reference or your order is released.`,
              reference: `manual-${field}-${tx.id}`,
            })
            .catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(
          `manual countdown (${label}) failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
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

  // Raffles no longer have an endTime — the cooling window is started
  // inline by RafflesService.confirmTickets / createPostalEntry the
  // moment ticketsSoldPaid+ticketsSoldPostal hits targetTicketCount, so
  // no time-based cron is required to roll ACTIVE → CLOSED_AWAITING_DRAW.

  // Run every 5 minutes — run draws for raffles past their cooling window.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runRaffleDraws() {
    try {
      const result = await this.rafflesService.runReadyDraws();
      if (result.processed > 0) {
        this.logger.log(`Ran ${result.processed} raffle draw(s)`);
      }
    } catch (err) {
      this.logger.error(
        `runRaffleDraws failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('raffle-draw');
    }
  }

  // Phase E3 — every 5 minutes, fire the 48h auto-draw for any
  // subscriber raffle whose subscriberDrawAt has passed. Re-uses
  // the same draw() pipeline so winners + DrawProof flow are
  // identical to public raffles. Separate cron from runRaffleDraws
  // so a public-raffle bug doesn't block subscriber-raffle draws
  // and vice versa.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runSubscriberRaffleDraws() {
    try {
      const result = await this.rafflesService.runSubscriberRaffleDraws();
      if (result.drawn > 0) {
        this.logger.log(`Drew ${result.drawn} subscriber raffle(s)`);
      }
    } catch (err) {
      this.logger.error(
        `runSubscriberRaffleDraws failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('subscriber-raffle-draw');
    }
  }

  // Run every hour — expire stale claim windows and promote backup winners.
  @Cron(CronExpression.EVERY_HOUR)
  async expireRaffleClaims() {
    try {
      const result = await this.rafflesService.expireClaims();
      if (result.processed > 0) {
        this.logger.log(`Expired ${result.processed} raffle claim(s)`);
      }
    } catch (err) {
      this.logger.error(
        `expireRaffleClaims failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      await this.recordCronRun('raffle-expire');
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
    await this.recordCronRun('dispatch-sla');
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
