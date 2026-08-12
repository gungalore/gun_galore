import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrizeDrawStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

// How long the winner banner stays on the public page after a draw.
const WINNER_BANNER_HOURS = 48;

// Cycle length per admin frequency setting. Applies to NEW draws only.
const CYCLE_DAYS: Record<string, number> = {
  MONTHLY: 30,
  BIWEEKLY: 14,
  WEEKLY: 7,
};

/**
 * AO PRO prize draw — a CPA s36 promotional competition, NOT a paid
 * lottery. The prize is a physical item bought by GG and displayed for
 * the whole cycle; every paid-up PRO member is entered automatically and
 * free. The budget maths (percent of recent subscription revenue) is
 * ADVISORY and admin-only — no money moves through this module, and no
 * public copy ever mentions percentages, pools, or subscription revenue.
 * Winners may exchange any prize for an alternative of equal value —
 * which is also how a licence-bearing prize is handled when the winner
 * cannot (or prefers not to) accept it.
 */
@Injectable()
export class RaffleService {
  private readonly logger = new Logger(RaffleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ----------------------------------------------------------------
  // Public surface (/raffle page).
  // ----------------------------------------------------------------
  async publicState() {
    const enabled = await this.settings.get(FLAGS.proDrawEnabled);
    if (!enabled) return { enabled: false as const };

    const now = Date.now();
    const [current, lastDrawn, pastWinners] = await Promise.all([
      this.prisma.prizeDraw.findFirst({
        where: { status: PrizeDrawStatus.LIVE },
        orderBy: { drawAt: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          prizeValueCents: true,
          imageUrls: true,
          displayStartAt: true,
          drawAt: true,
        },
      }),
      // Winner banner — most recent draw within the 48h window.
      this.prisma.prizeDraw.findFirst({
        where: {
          status: { in: [PrizeDrawStatus.DRAWN, PrizeDrawStatus.FULFILLED] },
          drawnAt: { gte: new Date(now - WINNER_BANNER_HOURS * 3_600_000) },
        },
        orderBy: { drawnAt: 'desc' },
        select: {
          title: true,
          prizeValueCents: true,
          drawnAt: true,
          winner: { select: { username: true } },
        },
      }),
      this.prisma.prizeDraw.findMany({
        where: {
          status: { in: [PrizeDrawStatus.DRAWN, PrizeDrawStatus.FULFILLED] },
          winnerUserId: { not: null },
        },
        orderBy: { drawnAt: 'desc' },
        take: 12,
        select: {
          title: true,
          prizeValueCents: true,
          drawnAt: true,
          winner: { select: { username: true } },
        },
      }),
    ]);

    return {
      enabled: true as const,
      current,
      // Usernames only — never real names on public surfaces.
      recentWinner: lastDrawn
        ? {
            username: lastDrawn.winner?.username ?? 'a member',
            prizeTitle: lastDrawn.title,
            prizeValueCents: lastDrawn.prizeValueCents,
            drawnAt: lastDrawn.drawnAt,
          }
        : null,
      pastWinners: pastWinners.map((w) => ({
        username: w.winner?.username ?? 'a member',
        prizeTitle: w.title,
        prizeValueCents: w.prizeValueCents,
        drawnAt: w.drawnAt,
      })),
    };
  }

  // ----------------------------------------------------------------
  // Eligibility — paid-up active PRO, not banned, not a comp/admin
  // grant (billingCycle 'comp' pays nothing, so it can't win — this
  // also automatically excludes the operator's own granted PRO).
  // ----------------------------------------------------------------
  private async eligibleEntrants(): Promise<{ id: string }[]> {
    return this.prisma.user.findMany({
      where: {
        subscriptionTier: 'PRO',
        isBanned: false,
        subscription: {
          status: 'ACTIVE',
          currentPeriodEnd: { gt: new Date() },
          billingCycle: { not: 'comp' },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  }

  // ----------------------------------------------------------------
  // Cron — run any LIVE draw whose drawAt has passed. Guarded by the
  // master flag; CAS-claimed so a double-fire can't pick two winners.
  // ----------------------------------------------------------------
  async runDueDraws() {
    const enabled = await this.settings.get(FLAGS.proDrawEnabled);
    if (!enabled) return;
    const due = await this.prisma.prizeDraw.findMany({
      where: { status: PrizeDrawStatus.LIVE, drawAt: { lt: new Date() } },
      select: { id: true },
      take: 10,
    });
    for (const d of due) {
      try {
        await this.drawWinner(d.id);
      } catch (err) {
        this.logger.error(
          `prize draw ${d.id} failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private async drawWinner(drawId: string) {
    const entrants = await this.eligibleEntrants();
    if (entrants.length === 0) {
      // Nothing to draw from — alert once and leave the draw LIVE so it
      // re-evaluates next cron run (entrants may still arrive).
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'raffle-no-entrants',
            referenceId: drawId,
            context: `Prize draw ${drawId} reached its draw date with ZERO eligible paid PRO members — draw postponed; it will retry hourly. Consider extending the display period or seeding membership first.`,
            urgent: true,
          },
        })
        .catch(() => undefined);
      return;
    }

    // Verifiably random pick + an audit record we retain (CPA record-
    // keeping): entrant count, sha256 of the ordered entrant ids, the
    // algorithm and timestamp. crypto.randomInt is not seedable/predictable.
    const winnerIndex = randomInt(entrants.length);
    const winnerUserId = entrants[winnerIndex].id;
    const entrantsHash = createHash('sha256')
      .update(entrants.map((e) => e.id).join(','))
      .digest('hex');
    const now = new Date();

    const claim = await this.prisma.prizeDraw.updateMany({
      where: { id: drawId, status: PrizeDrawStatus.LIVE },
      data: {
        status: PrizeDrawStatus.DRAWN,
        drawnAt: now,
        winnerUserId,
        entrantCount: entrants.length,
        drawAudit: {
          entrantCount: entrants.length,
          entrantsHash,
          winnerIndex,
          algorithm: 'crypto.randomInt over sha256-audited ordered entrant list',
          drawnAt: now.toISOString(),
        },
      },
    });
    if (claim.count === 0) return; // another worker drew it

    this.logger.log(
      `Prize draw ${drawId}: winner ${winnerUserId} from ${entrants.length} entrants`,
    );

    const [draw, winner] = await Promise.all([
      this.prisma.prizeDraw.findUnique({ where: { id: drawId } }),
      this.prisma.user.findUnique({ where: { id: winnerUserId } }),
    ]);
    if (draw && winner) {
      void this.notifications
        .raffleWinner({
          email: winner.email,
          name: winner.firstName ?? 'there',
          phone: winner.phone,
          prizeTitle: draw.title,
          prizeValueCents: draw.prizeValueCents,
        })
        .catch((e) =>
          this.logger.warn(`raffle winner notify failed: ${(e as Error).message}`),
        );
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'raffle-winner-fulfilment',
            referenceId: drawId,
            context: `Prize draw "${draw.title}" won by @${winner.username ?? winnerUserId} (${draw.entrantCount || entrants.length} entrants). Contact the winner to arrange handover — remember the equal-value exchange option, and the licensed-dealer route if the prize needs it.`,
            urgent: true,
          },
        })
        .catch(() => undefined);
    }
  }

  // ----------------------------------------------------------------
  // Admin surface (/admin/raffle).
  // ----------------------------------------------------------------

  // Advisory prize budget for the NEXT cycle: percent × SUCCEEDED
  // subscription revenue over the last cycle window, floored + rounded
  // UP to the nearest R100. Never public, never moves money.
  async adminSuggestedBudget() {
    const [pct, floorCents, frequency] = await Promise.all([
      this.settings.get(FLAGS.rafflePoolPercent),
      this.settings.get(FLAGS.raffleFloorCents),
      this.settings.get(FLAGS.raffleFrequency),
    ]);
    const cycleDays = CYCLE_DAYS[frequency] ?? 30;
    const windowStart = new Date(Date.now() - cycleDays * 86_400_000);
    const revenue = await this.prisma.subscriptionCharge.aggregate({
      where: { status: 'SUCCEEDED', chargedAt: { gte: windowStart } },
      _sum: { amountCents: true },
    });
    const revenueCents = revenue._sum.amountCents ?? 0;
    const raw = Math.round((revenueCents * pct) / 100);
    const suggested = Math.ceil(Math.max(raw, floorCents) / 10_000) * 10_000;
    const payingMembers = (await this.eligibleEntrants()).length;
    return {
      frequency,
      cycleDays,
      poolPercent: pct,
      floorCents,
      windowRevenueCents: revenueCents,
      payingMembers,
      suggestedBudgetCents: suggested,
    };
  }

  async adminState() {
    const [budget, enabled, draws] = await Promise.all([
      this.adminSuggestedBudget(),
      this.settings.get(FLAGS.proDrawEnabled),
      this.prisma.prizeDraw.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { winner: { select: { username: true } } },
      }),
    ]);
    return { enabled, budget, draws };
  }

  async adminUploadImage(file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('An image is required');
    const up = await this.cloudinary.uploadImage(file.buffer, 'prize-draws');
    return { url: up.url };
  }

  async adminCreateDraw(dto: {
    title?: string;
    description?: string;
    prizeValueCents?: number;
    imageUrls?: string[];
    drawAt?: string;
  }) {
    const title = (dto.title ?? '').trim();
    const description = (dto.description ?? '').trim();
    const value = Math.round(dto.prizeValueCents ?? 0);
    if (title.length < 3) throw new BadRequestException('Give the prize a title.');
    if (description.length < 10) {
      throw new BadRequestException('Describe the prize (10+ characters).');
    }
    if (value < 10_000) {
      throw new BadRequestException('Prize value must be at least R100.');
    }
    if (!dto.imageUrls?.length) {
      throw new BadRequestException(
        'Add at least one photo — the prize is displayed for the whole cycle.',
      );
    }
    // Only one prize on display at a time — the page shows a single
    // current draw and CPA rules are per-competition.
    const open = await this.prisma.prizeDraw.count({
      where: { status: PrizeDrawStatus.LIVE },
    });
    if (open > 0) {
      throw new BadRequestException(
        'There is already a live prize on display. Cancel it or wait for its draw before creating the next one.',
      );
    }
    const frequency = await this.settings.get(FLAGS.raffleFrequency);
    const cycleDays = CYCLE_DAYS[frequency] ?? 30;
    const drawAt = dto.drawAt
      ? new Date(dto.drawAt)
      : new Date(Date.now() + cycleDays * 86_400_000);
    if (!(drawAt instanceof Date) || isNaN(drawAt.getTime()) || drawAt <= new Date()) {
      throw new BadRequestException('The draw date must be in the future.');
    }
    return this.prisma.prizeDraw.create({
      data: {
        title,
        description,
        prizeValueCents: value,
        imageUrls: dto.imageUrls.slice(0, 6),
        drawAt,
      },
    });
  }

  async adminMarkFulfilled(drawId: string, note?: string) {
    const claim = await this.prisma.prizeDraw.updateMany({
      where: { id: drawId, status: PrizeDrawStatus.DRAWN },
      data: {
        status: PrizeDrawStatus.FULFILLED,
        fulfilledAt: new Date(),
        fulfilmentNote: (note ?? '').trim().slice(0, 500) || null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Draw is not awaiting fulfilment.');
    }
    void this.prisma.adminAlert
      .updateMany({
        where: {
          type: 'raffle-winner-fulfilment',
          referenceId: drawId,
          resolved: false,
        },
        data: { resolved: true, resolvedAt: new Date() },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async adminCancelDraw(drawId: string, reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException('A reason is required to cancel a draw.');
    }
    const claim = await this.prisma.prizeDraw.updateMany({
      where: { id: drawId, status: PrizeDrawStatus.LIVE },
      data: { status: PrizeDrawStatus.CANCELLED, cancelledReason: trimmed.slice(0, 500) },
    });
    if (claim.count === 0) {
      throw new NotFoundException('No live draw with that id.');
    }
    return { ok: true };
  }
}
