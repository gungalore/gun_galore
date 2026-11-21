import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ────────────────────────────────────────────────────────────────────
// THE SUPPORT TIMELINE.
//
// Operator, 2026-11-21: "we need to log every motivation activities so we can
// pin point every move of the user so we can immediately fix the issue once
// it's been reported."
//
// One row per meaningful move on an application. It is read by support, after
// the fact, next to a member's own description of what went wrong — so it has
// to be complete enough to reconstruct the step and safe enough that reading
// it is not a privacy event.
//
// ⚠️ NO ANSWER VALUES. `detail` is passed through sanitiseActivityDetail, which
// keeps only short strings, finite numbers, booleans and arrays of short
// strings. Keys, counts, section ids, enum labels, field NAMES — that is the
// whole vocabulary. An ID number, an address, a serial or the text of an
// answer must never reach this table: it has no encryption, and every admin
// can read it.
//
// ⚠️ LOGGING NEVER BREAKS THE THING IT LOGS. Every method catches its own
// failure and warns. A support trail that can fail a save is worse than no
// support trail.
// ────────────────────────────────────────────────────────────────────

/** Caps that keep one row small and prevent a blob being smuggled in. */
const MAX_DETAIL_KEYS = 12;
const MAX_KEY_LENGTH = 40;
const MAX_STRING = 120;
const MAX_ARRAY = 12;
const KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Actions the browser may report about itself. Server-side writes are free. */
export const CLIENT_ACTIVITY_ACTIONS = [
  'client_page_view',
  'client_step_viewed',
  'client_pay_clicked',
  'client_bank_returned',
  'client_download_clicked',
  'client_print_clicked',
  'client_bug_report_opened',
  'client_beta_notice_seen',
] as const;

export type ClientActivityAction = (typeof CLIENT_ACTIVITY_ACTIONS)[number];

export interface MotivationActivityInput {
  motivationId?: string | null;
  motivationRef: string;
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
  path?: string | null;
}

export interface MotivationActivityRow {
  id: string;
  motivationId: string | null;
  motivationRef: string;
  action: string;
  detail: Prisma.JsonValue | null;
  path: string | null;
  createdAt: Date;
}

/**
 * Drop anything that could be sensitive, oversized or a nested dump.
 *
 * Deliberately allowlist-shaped: an unrecognised value type is DROPPED rather
 * than stringified. `String(value)` on an object is how "[object Object]" ends
 * up in a support trail, and on an array it is how a whole answer list leaks.
 */
export function sanitiseActivityDetail(
  input?: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string | number | boolean | string[]> = {};
  let keys = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (keys >= MAX_DETAIL_KEYS) break;
    const key = rawKey.slice(0, MAX_KEY_LENGTH);
    if (!KEY_PATTERN.test(key)) continue;

    if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_STRING);
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      const strings = value
        .filter((v): v is string => typeof v === 'string')
        .slice(0, MAX_ARRAY)
        .map((v) => v.slice(0, MAX_STRING));
      if (strings.length > 0) out[key] = strings;
    }
    // Everything else (objects, null, functions) is dropped on purpose.
    keys += 1;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

@Injectable()
export class MotivationActivityService {
  private readonly logger = new Logger(MotivationActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append one event. Awaited by the caller so the order in the table matches
   * the order on the screen; never throws.
   */
  async record(input: MotivationActivityInput): Promise<void> {
    try {
      await this.prisma.motivationActivity.create({
        data: {
          motivationId: input.motivationId ?? null,
          userId: input.userId ?? null,
          motivationRef: input.motivationRef,
          action: input.action.slice(0, 60),
          detail: sanitiseActivityDetail(input.detail),
          path: input.path ? input.path.slice(0, 512) : null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Motivation activity "${input.action}" for ${input.motivationRef} not recorded: ${(err as Error).message}`,
      );
    }
  }

  /** The timeline for one application, newest first. */
  async forMotivation(
    motivationId: string,
    limit = 200,
  ): Promise<MotivationActivityRow[]> {
    return this.prisma.motivationActivity.findMany({
      where: { motivationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      select: {
        id: true,
        motivationId: true,
        motivationRef: true,
        action: true,
        detail: true,
        path: true,
        createdAt: true,
      },
    });
  }

  /** Everything this member did, across applications — the bug-report view. */
  async forUser(userId: string, limit = 50): Promise<MotivationActivityRow[]> {
    return this.prisma.motivationActivity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        motivationId: true,
        motivationRef: true,
        action: true,
        detail: true,
        path: true,
        createdAt: true,
      },
    });
  }

  /** Lookup by the MO number support is given, after the row itself is gone. */
  async forReference(
    motivationRef: string,
    limit = 200,
  ): Promise<MotivationActivityRow[]> {
    return this.prisma.motivationActivity.findMany({
      where: { motivationRef },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      select: {
        id: true,
        motivationId: true,
        motivationRef: true,
        action: true,
        detail: true,
        path: true,
        createdAt: true,
      },
    });
  }

  /**
   * The tail that goes into a support email, one line per event.
   *
   * Format is deliberately plain text: it is read in an inbox, often on a
   * phone, and it is what the operator scans to find the step that broke.
   */
  static formatTimeline(rows: MotivationActivityRow[]): string {
    if (rows.length === 0) return 'No activity recorded.';
    return rows
      .slice()
      .reverse()
      .map((r) => {
        const at = r.createdAt.toISOString().replace('T', ' ').slice(0, 19);
        const detail =
          r.detail && typeof r.detail === 'object'
            ? ' ' +
              Object.entries(r.detail as Record<string, unknown>)
                .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`)
                .join(' ')
            : '';
        const path = r.path ? ` (${r.path})` : '';
        return `${at}Z  ${r.motivationRef}  ${r.action}${detail}${path}`;
      })
      .join('\n');
  }
}
