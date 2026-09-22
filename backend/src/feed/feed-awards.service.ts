// ────────────────────────────────────────────────────────────────────
// COMMUNITY AWARDS — cosmetic points, levels and a monthly leaderboard.
//
// ⚠️ COSMETIC ONLY. Awards must NEVER grant prize-draw entries: converting
// activity into competition entries walks straight into promotional-
// competition rules and poisons the draw's subscription-benefit framing.
//
// Anti-farming: points are earned for AUTHORED content (posts, comments) and
// for likes RECEIVED, never for likes GIVEN. Authored points are capped per
// member per UTC day so a member cannot farm the ladder overnight.
//
// Everything is flag-gated on `feed_awards_enabled` (default OFF): when it is
// off, award() is a no-op and the leaderboard reports disabled.
// ────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { FeedAwardReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';

export const FEED_AWARD_POINTS: Record<FeedAwardReason, number> = {
  POST: 10,
  COMMENT: 3,
  LIKE_RECEIVED: 1,
};

/** Authored-content points per member per UTC day — anti-farming cap. */
export const FEED_DAILY_CAP = 60;

export interface FeedLevel {
  name: string;
  min: number;
}

/**
 * Bilingual SA outdoor ranks, lowest first. Deliberately weapon-free so the
 * names are safe if a level ever surfaces outside the members-only feed.
 */
export const FEED_LEVELS: FeedLevel[] = [
  { name: 'Groentjie', min: 0 },
  { name: 'Veldgids', min: 100 },
  { name: 'Spoorsnyer', min: 300 },
  { name: 'Kampleier', min: 700 },
  { name: 'Overlander', min: 1500 },
  { name: 'Legende', min: 3000 },
];

export function levelFor(points: number): FeedLevel {
  let current = FEED_LEVELS[0];
  for (const level of FEED_LEVELS) {
    if (points >= level.min) current = level;
  }
  return current;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Injectable()
export class FeedAwardsService {
  private readonly logger = new Logger(FeedAwardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return this.settings.get(FLAGS.feedAwardsEnabled);
  }

  /**
   * Grant points for one event. Best-effort: an awards write must never break
   * the post/comment/like it rides on.
   */
  async award(
    userId: string,
    reason: FeedAwardReason,
    refId?: string,
  ): Promise<void> {
    try {
      if (!(await this.isEnabled())) return;

      let points = FEED_AWARD_POINTS[reason];
      if (
        reason === FeedAwardReason.POST ||
        reason === FeedAwardReason.COMMENT
      ) {
        const rows = await this.prisma.feedAward.findMany({
          where: {
            userId,
            reason: {
              in: [FeedAwardReason.POST, FeedAwardReason.COMMENT],
            },
            createdAt: { gte: startOfUtcDay() },
          },
          select: { points: true },
        });
        const today = rows.reduce((sum, r) => sum + r.points, 0);
        if (today >= FEED_DAILY_CAP) return;
        points = Math.min(points, FEED_DAILY_CAP - today);
      }
      if (points <= 0) return;

      await this.prisma.$transaction([
        this.prisma.feedAward.create({
          data: { userId, reason, points, refId },
        }),
        this.prisma.userSocialStats.upsert({
          where: { userId },
          create: { userId, points },
          update: { points: { increment: points } },
        }),
      ]);
    } catch (e) {
      this.logger.warn(`feed award failed: ${(e as Error).message}`);
    }
  }

  async levelForUser(
    userId: string,
  ): Promise<{ name: string; points: number }> {
    const stats = await this.prisma.userSocialStats.findUnique({
      where: { userId },
      select: { points: true },
    });
    const points = stats?.points ?? 0;
    return { name: levelFor(points).name, points };
  }

  /** Monthly leaderboard, usernames only. */
  async leaderboard(limit = 20) {
    if (!(await this.isEnabled())) {
      return { enabled: false, entries: [] };
    }
    const grouped = await this.prisma.feedAward.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: startOfUtcMonth() } },
      _sum: { points: true },
      orderBy: { _sum: { points: 'desc' } },
      take: Math.min(limit, 50),
    });
    const ids = grouped.map((g) => g.userId);
    if (ids.length === 0) return { enabled: true, entries: [] };

    const [users, stats] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, avatarUrl: true },
      }),
      this.prisma.userSocialStats.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, points: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const pointsByUser = new Map(stats.map((s) => [s.userId, s.points]));

    return {
      enabled: true,
      entries: grouped.map((g, index) => {
        const total = pointsByUser.get(g.userId) ?? 0;
        return {
          rank: index + 1,
          username: userById.get(g.userId)?.username ?? 'Anonymous',
          avatarUrl: userById.get(g.userId)?.avatarUrl ?? null,
          monthlyPoints: g._sum.points ?? 0,
          points: total,
          level: levelFor(total).name,
        };
      }),
    };
  }
}
