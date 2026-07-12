import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { SubscriptionTier } from '@prisma/client';

/**
 * Ask GG quota / fair-use enforcement.
 *
 * Per spec OD3 (locked 2026-05-25), defaults:
 *   FREE   → 5 messages per rolling 30-day window
 *   MEMBER → 20 messages per hour fair-use cap
 *   PRO    → 60 messages per hour fair-use cap
 *
 * Sign-in is enforced by ClerkGuard on every Ask GG route — this
 * service assumes the caller is already authenticated and just gates
 * on tier + history.
 *
 * Ask GG Everywhere: caps now live in SettingsService.FLAGS
 * (ask_gg_* keys) so the operator can tune spend live from
 * /admin/settings without a deploy. Reads fail open to the OD3
 * defaults above (SettingsService.get already fail-opens).
 */

// Phase E3 — per-request photo cap (how many photos in ONE upload).
// Originally proposed 5→20 for Pro under the "bulk identification"
// idea; operator call 2026-05-26 trimmed to 10. Member + Free stay
// at 5 because the realistic use case is multi-angle of ONE firearm.
export function maxPhotosPerRequest(tier: SubscriptionTier): number {
  return tier === SubscriptionTier.PRO ? 10 : 5;
}

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Compute the current quota snapshot. Cheap-ish: one COUNT + one
   * findFirst on AskGgMessage, both hitting the
   * (conversationId, createdAt) composite index via the user-scoped
   * relation filter. Caps come from admin-tunable Settings flags
   * (fail-open to the OD3 defaults).
   */
  async snapshot(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<QuotaSnapshot> {
    const now = Date.now();

    if (tier === 'FREE') {
      const cap = await this.settings.get(FLAGS.askGgFreeMsgCapPer30d);
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
        cap,
        remaining: Math.max(0, cap - used),
        windowResetsAt,
        windowLengthMs: THIRTY_DAYS_MS,
      };
    }

    // MEMBER + PRO — hourly fair-use.
    const cap =
      tier === 'PRO'
        ? await this.settings.get(FLAGS.askGgProMsgCapPerHour)
        : await this.settings.get(FLAGS.askGgMemberMsgCapPerHour);
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

  /**
   * FREE-tier photo-ID cap check. Counts photo-bearing requests (NOT
   * individual photos) in the rolling 30-day window — a 5-photo
   * upload = 1 photo-ID for quota purposes. MEMBER + PRO are
   * unlimited on photo IDs (caps only on hourly message rate via
   * assertCanSend).
   *
   * Throws 403 { code: 'free-photo-quota-exhausted' } if FREE user
   * has spent all 5 photo-IDs in the past 30 days. The frontend
   * shows an upgrade nudge without flipping the whole chat to the
   * UpgradeCard (text-only messages should still work for users who
   * haven't blown their message cap).
   */
  async assertCanUploadPhotos(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<void> {
    if (tier !== 'FREE') return; // MEMBER + PRO have no photo cap
    const cap = await this.settings.get(FLAGS.askGgFreePhotoCapPer30d);
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const used = await this.countPhotoIdRequestsSince(userId, since);
    if (used < cap) return;
    throw new ForbiddenException({
      message: `You've used your ${cap} free photo identifications this month. Upgrade to Member or Pro for unlimited.`,
      code: 'free-photo-quota-exhausted',
      cap,
      used,
      minTier: 'MEMBER',
    });
  }

  /** Photo-ID snapshot — exposed via /ask-gg/quota alongside the
   *  message snapshot so the frontend can render the "N photo IDs
   *  left this month" pill for FREE users. */
  async photoSnapshot(
    userId: string,
    tier: SubscriptionTier,
  ): Promise<{
    tier: SubscriptionTier;
    used: number;
    cap: number;
    remaining: number;
    unlimited: boolean;
  }> {
    if (tier !== 'FREE') {
      return { tier, used: 0, cap: 0, remaining: 0, unlimited: true };
    }
    const cap = await this.settings.get(FLAGS.askGgFreePhotoCapPer30d);
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const used = await this.countPhotoIdRequestsSince(userId, since);
    return {
      tier,
      used,
      cap,
      remaining: Math.max(0, cap - used),
      unlimited: false,
    };
  }

  // ─── internals ────────────────────────────────────────────────────

  /** Count user messages WITH photos sent in the active window.
   *  imageUrls is a String[] column; non-empty array = photo request. */
  private async countPhotoIdRequestsSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.askGgMessage.count({
      where: {
        role: 'user',
        createdAt: { gte: since },
        conversation: { userId },
        imageUrls: { isEmpty: false },
      },
    });
  }

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
