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
  ) {}

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
      this.logger.warn(
        `Pudo tracking poll failed: ${(err as Error).message}`,
      );
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
      this.logger.warn(
        `Dispatch SLA nudge failed: ${(err as Error).message}`,
      );
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
}
