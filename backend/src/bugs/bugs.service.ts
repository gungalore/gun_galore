import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MotivationActivityService } from '../motivations/motivation-activity.service';

// Member-submitted bug reports. One-way: the report is emailed to the support
// mailbox (see NotificationsService.bugReport) and nothing is stored.
//
// ⚠️ SINCE 2026-11-21 THE REPORT CARRIES THE MEMBER'S HANDLE AND THEIR LAST
// MOTIVATION STEPS. Operator: "in the report a bug we need the user name so we
// can go into the logs and pin point the exact issue along with their
// description." A description alone ("it glitched when I pressed write") is not
// actionable at 22:00; @name plus the activity tail is.
//
// The category list is deliberately small and product-shaped (Marketplace,
// Auctions, Payments, ...), not a free string, so the subject line is always
// something the operator can triage at a glance. Keep it in step with the
// frontend list in frontend/app/report-a-bug/page.tsx.
export const BUG_CATEGORIES = [
  'BUY_NOW',
  'AUCTION',
  'PAYMENT',
  'OFFERS',
  'LISTING',
  'DELIVERY',
  'MOTIVATIONS',
  'PAPERWORK_VAULT',
  'ACCOUNT',
  'OTHER',
] as const;

export type BugCategory = (typeof BUG_CATEGORIES)[number];

const CATEGORY_LABELS: Record<BugCategory, string> = {
  BUY_NOW: 'Marketplace',
  AUCTION: 'Auctions',
  PAYMENT: 'Payments',
  OFFERS: 'Offers',
  LISTING: 'Selling / Listing',
  DELIVERY: 'Delivery / Shipping',
  MOTIVATIONS: 'Motivations',
  PAPERWORK_VAULT: 'Paperwork Vault',
  ACCOUNT: 'Account & Login',
  OTHER: 'Other',
};

const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
/** A human cannot read the page, type 10+ chars and send in under this. */
const MIN_FORM_MS = 1500;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extensionFor(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
}

export interface ReportBugInput {
  /** Present only when a valid session was supplied; signed-out reports are allowed. */
  userId?: string | null;
  category?: string;
  description?: string;
  url?: string;
  /** Optional reply address for a signed-out reporter. */
  email?: string;
  /** Bot trap — must be empty. */
  honeypot?: string;
  /** Milliseconds from form mount to submit. */
  elapsedMs?: number;
  screenshot?: { buffer: Buffer; mimetype: string } | null;
}

const MAX_URL_LENGTH = 2048;

/** Keep only an http(s) URL, capped. Anything else (missing, junk, a
 *  javascript:/data: scheme) becomes null rather than reaching the email. */
function cleanUrl(raw?: string): string | null {
  const value = (raw ?? '').trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * The motivation a reported URL points at, if any.
 *
 * `/licence-centre/<cuid>` and `/licence-centre/<cuid>/pack` are the shapes the
 * member is on when things break. Deliberately shape-checked rather than
 * trusting any path segment: the value is used in a database lookup.
 */
export function motivationIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /\/licence-centre\/([a-z0-9]{20,40})(?:[/?#]|$)/i.exec(url);
  return match?.[1] ?? null;
}

@Injectable()
export class BugsService {
  private readonly logger = new Logger(BugsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly activity: MotivationActivityService,
  ) {}

  async report(input: ReportBugInput): Promise<{ received: true }> {
    // ── Public-form anti-bot floor ────────────────────────────────────
    // A filled honeypot is a silent discard: telling the bot which field gave
    // it away only teaches the next one. The time gate and per-IP throttle are
    // in the controller/decorator; this is the cheap first line.
    if ((input.honeypot ?? '').trim().length > 0) {
      return { received: true };
    }
    if (
      !Number.isFinite(input.elapsedMs) ||
      (input.elapsedMs as number) < MIN_FORM_MS
    ) {
      throw new BadRequestException(
        'Please take a moment to check the report and try again.',
      );
    }

    const category = (input.category ?? '').trim().toUpperCase();
    if (!(BUG_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException('Choose a valid category.');
    }

    const description = (input.description ?? '').trim();
    if (description.length < MIN_DESCRIPTION) {
      throw new BadRequestException(
        'Please describe the problem in a bit more detail.',
      );
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new BadRequestException(
        `Keep the description under ${MAX_DESCRIPTION} characters.`,
      );
    }

    const shot = input.screenshot ?? null;
    if (shot && shot.buffer.length > MAX_SCREENSHOT_BYTES) {
      throw new BadRequestException('Screenshot is too large (max 8 MB).');
    }

    const url = cleanUrl(input.url);

    // Signed-out reports may leave an email; members are identified by their
    // account, so their form value is ignored. An invalid public email is a
    // typo the visitor can fix, not a reason to lose the report.
    const publicEmail = (input.email ?? '').trim();
    if (
      !input.userId &&
      publicEmail &&
      (publicEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(publicEmail))
    ) {
      throw new BadRequestException(
        'Enter a valid email address, or leave it blank.',
      );
    }

    // ⚠️ THE HANDLE IS THE SUPPORT KEY. Username is public and searchable; the
    // cuid is not something a member can give a human on the phone.
    const user = input.userId
      ? await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { username: true, email: true },
        })
      : null;

    // Signed-out reports have no account timeline to attach. Member reports
    // still get the motivation steps that make a 22:00 bug actionable.
    let motivationRef: string | null = null;
    let timeline = '';
    if (input.userId) {
      const motivationId = motivationIdFromUrl(url);
      if (motivationId) {
        const motivation = await this.prisma.motivation.findFirst({
          where: { id: motivationId, userId: input.userId },
          select: { referenceNumber: true },
        });
        if (motivation) {
          motivationRef = motivation.referenceNumber;
          const rows = await this.activity.forMotivation(motivationId, 60);
          timeline = MotivationActivityService.formatTimeline(rows);
          // The report itself is part of the trail: support sees "member filed
          // a bug" at the end of the very timeline it describes.
          void this.activity.record({
            motivationId,
            motivationRef,
            userId: input.userId,
            action: 'bug_reported',
            detail: { category },
          });
        }
      }
      if (!timeline) {
        // Not on a motivation page (or not theirs): a member-level tail still
        // beats nothing.
        const rows = await this.activity.forUser(input.userId, 25);
        timeline = rows.length
          ? MotivationActivityService.formatTimeline(rows)
          : '';
      }
    }

    // ⚠️ DO NOT AWAIT THE EMAIL. The report used to wait on the Resend API —
    // including a multi-megabyte screenshot attachment - inside this HTTP
    // request. On a phone that can exceed nginx's 95s read timeout, so the
    // request is cut and Safari reports the bare "Load failed" (2026-11-24: a
    // buyer stuck on a grey Pay button could not send the report that would
    // have told us why). The report is validated first; delivery is
    // fire-and-forget, and a failed send raises an admin alert instead of
    // blocking the form.
    void this.notifications
      .bugReport({
        category: CATEGORY_LABELS[category as BugCategory],
        description,
        reporterId: input.userId ?? null,
        reporterUsername: user?.username ?? null,
        reporterEmail: input.userId ? (user?.email ?? null) : publicEmail || null,
        motivationRef,
        url,
        activity: timeline || null,
        screenshot: shot
          ? {
              buffer: shot.buffer,
              filename: `bug-${Date.now()}.${extensionFor(shot.mimetype)}`,
            }
          : null,
      })
      .catch((err: unknown) => {
        this.logger.error(
          `bug report email failed (${category}, reporter ${input.userId ?? 'signed-out'}): ${(err as Error).message}`,
        );
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'BUG_REPORT_EMAIL_FAILED',
              referenceId: input.userId ?? null,
              context: `A ${CATEGORY_LABELS[category as BugCategory]} bug report was accepted but the support email failed to send (${(err as Error).message}). Description: ${description.slice(0, 500)}`,
            },
          })
          .catch(() => undefined);
      });

    return { received: true };
  }
}
