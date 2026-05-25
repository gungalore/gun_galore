import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionTier } from '@prisma/client';

/**
 * Ask GG quota / fair-use enforcement.
 *
 * Per spec OD3 (locked 2026-05-25):
 *   FREE   → 5 messages per rolling 30-day window
 *   MEMBER → 20 messages per hour fair-use cap
 *   PRO    → 60 messages per hour fair-use cap
 *
 * Sign-in is enforced by ClerkGuard on every Ask GG route — this
 * service assumes the caller is already authenticated and just gates
 * on tier + history.
 *
 * Defaults are hardcoded for Drop 1; a follow-up drop will move them
 * to SettingsService.FLAGS so the operator can tune live from
 * /admin/settings (per the plan's "Cost-control hooks" section).
 */
const FREE_MSG_CAP_PER_30_DAYS = 5;
const MEMBER_MSG_CAP_PER_HOUR = 20;
const PRO_MSG_CAP_PER_HOUR = 60;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface QuotaSnapshot {
  tier: SubscriptionTier;
  /** How many user messages were sent in the active window. */
  used: number;
  /** Cap for this tier in this window. */
  cap: number;
  /** Messages still available in the active window. */
  remaining: number;
  /** ISO-readable Date when the active window resets. For FREE this
   *  is when the oldest message in the window ages out (rolling
   *  30-day); for MEMBER/PRO it's when the oldest message in the
   *  current hour ages out. */
  windowResetsAt: Date;
  /** Length of the window the user is being measured against, in ms.
   *  Frontend uses this to format friendly copy
   *  ("5 messages this month" vs "20 messages per hour"). */
  windowLengthMs: number;
}

@Injectable()
export class AskGgQuotaService {
  private readonly logger = new Logger(AskGgQuotaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the current quota snapshot. Cheap-ish: one COUNT + one
   * findFirst on AskGgMessage, both hitting the
   * (conversationId, createdAt) composite index via the user-scoped
   * relation filter.
   */
  async snapshot(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<QuotaSnapshot> {
    const now = Date.now();

    if (tier === 'FREE') {
      const since = new Date(now - THIRTY_DAYS_MS);
      const used = await this.countUserMessagesSince(userId, since);
      const oldest = await this.firstUserMessageSince(userId, since);
      // Reset = when the oldest in-window message ages out.
      // If none, reset is 30 days from now (no consumption yet).
      const windowResetsAt = oldest
        ? new Date(oldest.getTime() + THIRTY_DAYS_MS)
        : new Date(now + THIRTY_DAYS_MS);
      return {
        tier,
        used,
        cap: FREE_MSG_CAP_PER_30_DAYS,
        remaining: Math.max(0, FREE_MSG_CAP_PER_30_DAYS - used),
        windowResetsAt,
        windowLengthMs: THIRTY_DAYS_MS,
      };
    }

    // MEMBER + PRO — hourly fair-use.
    const cap = tier === 'PRO' ? PRO_MSG_CAP_PER_HOUR : MEMBER_MSG_CAP_PER_HOUR;
    const since = new Date(now - ONE_HOUR_MS);
    const used = await this.countUserMessagesSince(userId, since);
    const oldest = await this.firstUserMessageSince(userId, since);
    const windowResetsAt = oldest
      ? new Date(oldest.getTime() + ONE_HOUR_MS)
      : new Date(now + ONE_HOUR_MS);
    return {
      tier,
      used,
      cap,
      remaining: Math.max(0, cap - used),
      windowResetsAt,
      windowLengthMs: ONE_HOUR_MS,
    };
  }

  /**
   * Throw the right exception if the user has hit their cap. Called
   * inline by AskGgService.sendMessage before any DB writes for the
   * new turn so we don't burn an empty conversation row.
   *
   *   FREE at cap     → 403 { code: 'free-quota-exhausted' }
   *   MEMBER/PRO at cap → 429 { code: 'fair-use-pause' }
   *
   * Frontend decodes the body to pick the right card (upgrade vs
   * cool-off countdown).
   */
  async assertCanSend(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<void> {
    const snap = await this.snapshot(userId, tier);
    if (snap.remaining > 0) return;

    if (snap.tier === 'FREE') {
      throw new ForbiddenException({
        message: `You've used your ${snap.cap} free Ask GG messages this month. Upgrade to Member or Pro to keep going.`,
        code: 'free-quota-exhausted',
        cap: snap.cap,
        used: snap.used,
        windowResetsAt: snap.windowResetsAt.toISOString(),
        minTier: 'MEMBER',
      });
    }

    const retryAfterSec = Math.max(
      1,
      Math.ceil((snap.windowResetsAt.getTime() - Date.now()) / 1000),
    );
    const retryAfterMin = Math.ceil(retryAfterSec / 60);
    throw new HttpException(
      {
        message: `Quick break — fair-use cap. Back in ${retryAfterMin} min.`,
        code: 'fair-use-pause',
        cap: snap.cap,
        used: snap.used,
        retryAfterSec,
        windowResetsAt: snap.windowResetsAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // ─── internals ────────────────────────────────────────────────────

  private async countUserMessagesSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.askGgMessage.count({
      where: {
        role: 'user',
        createdAt: { gte: since },
        conversation: { userId },
      },
    });
  }

  private async firstUserMessageSince(
    userId: string,
    since: Date,
  ): Promise<Date | null> {
    const m = await this.prisma.askGgMessage.findFirst({
      where: {
        role: 'user',
        createdAt: { gte: since },
        conversation: { userId },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return m?.createdAt ?? null;
  }
}
