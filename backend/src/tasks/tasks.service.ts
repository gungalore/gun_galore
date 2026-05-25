import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
import { RafflesService } from '../raffles/raffles.service';
import { FeaturedService } from '../featured/featured.service';
import { KycService } from '../kyc/kyc.service';
import { TrackingService } from '../shipping/tracking.service';
import { DispatchSlaService } from '../payments/dispatch-sla.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreditsService } from '../admin/admin-credits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { PushService } from '../push/push.service';

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
    private readonly auctionsService: AuctionsService,
    private readonly rafflesService: RafflesService,
    private readonly featured: FeaturedService,
    private readonly kycService: KycService,
    private readonly trackingService: TrackingService,
    private readonly dispatchSla: DispatchSlaService,
    private readonly prisma: PrismaService,
    private readonly adminCredits: AdminCreditsService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly push: PushService,
  ) {}

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
      await this.recordCronRun('push-prune');
      if (removed > 0) {
        this.logger.log(`pushSubscriptionPrune: removed ${removed} stale subs`);
      }
    } catch (err) {
      this.logger.error(
        `pushSubscriptionPrune failed: ${(err as Error).message}`,
      );
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
  @Cron(CronExpression.EVERY_MINUTE)
  async featuredTick() {
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
    const bindCutoff = new Date(now.getTime() - cfg.bindWindowSec * 1000);
    const expiredBinds = await this.prisma.featuredSlot.findMany({
      where: {
        status: 'BIND_WINDOW',
        currentAuction: { closedAt: { lte: bindCutoff } },
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

  // Run every 10 minutes — expire pending/countered offers past their TTL.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireOffers() {
    this.logger.debug('Running offer expiry cron');
    await this.offersService.expireStale();
    await this.recordCronRun('offer-expire');
  }

  // Run every minute — finalize auctions whose endTime has passed.
  @Cron(CronExpression.EVERY_MINUTE)
  async endAuctions() {
    const result = await this.auctionsService.endStale();
    if (result.processed > 0) {
      this.logger.log(`Finalised ${result.processed} auction(s)`);
    }
    await this.recordCronRun('auction-end');
  }

  // Raffles no longer have an endTime — the cooling window is started
  // inline by RafflesService.confirmTickets / createPostalEntry the
  // moment ticketsSoldPaid+ticketsSoldPostal hits targetTicketCount, so
  // no time-based cron is required to roll ACTIVE → CLOSED_AWAITING_DRAW.

  // Run every 5 minutes — run draws for raffles past their cooling window.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runRaffleDraws() {
    const result = await this.rafflesService.runReadyDraws();
    if (result.processed > 0) {
      this.logger.log(`Ran ${result.processed} raffle draw(s)`);
    }
    await this.recordCronRun('raffle-draw');
  }

  // Run every hour — expire stale claim windows and promote backup winners.
  @Cron(CronExpression.EVERY_HOUR)
  async expireRaffleClaims() {
    const result = await this.rafflesService.expireClaims();
    if (result.processed > 0) {
      this.logger.log(`Expired ${result.processed} raffle claim(s)`);
    }
    await this.recordCronRun('raffle-expire');
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
