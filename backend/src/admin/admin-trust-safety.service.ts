import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// AdminAlert.context is a JSON string ({ reason, note, reporterId, ... }).
// Pull a human reason out of it for the trust-safety queue, falling back
// gracefully for legacy / malformed rows.
function parseReason(context: string | null): string {
  if (!context) return 'unspecified';
  try {
    const o = JSON.parse(context) as { reason?: string; note?: string };
    return o.note?.trim() || o.reason || 'unspecified';
  } catch {
    return context.slice(0, 80);
  }
}

/**
 * Trust & Safety queue — surfaces evidence of off-platform-coordination
 * attempts and other guardrail trips so an operator can decide whether
 * a user needs a warning, a ban, or a closer look.
 *
 * Three feeds:
 *
 *   1. Recent contact-detail rejections — every block from
 *      ContactDetailFilterService over the last 7 days, joined to the
 *      user. Reverse-chronological so the latest activity surfaces first.
 *
 *   2. Repeat offenders — users with ≥3 rejections in the same
 *      window. These are the ban candidates; a one-off slip is
 *      different from a pattern.
 *
 *   3. Reported Q&A — ListingQuestion rows whose reportedCount > 0.
 *      Buyers / sellers flag these manually so they always deserve
 *      eyes even if Claude's moderator passed them.
 */

export interface ContactRejectionRow {
  id: string;
  channel: string;
  category: string;
  sampleText: string;
  createdAt: Date;
  user: {
    id: string;
    username: string | null;
    email: string;
  } | null;
}

export interface RepeatOffender {
  userId: string;
  username: string | null;
  email: string;
  rejectionCount: number;
  lastRejectionAt: Date;
}

export interface ReportedQuestion {
  id: string;
  question: string;
  reportedCount: number;
  status: string;
  createdAt: Date;
  listing: { id: string; title: string };
  asker: { username: string | null };
}

@Injectable()
export class AdminTrustSafetyService {
  constructor(private readonly prisma: PrismaService) {}

  // Recent rejections — last 7 days, newest first, capped at 100.
  async recentRejections(limit = 100): Promise<ContactRejectionRow[]> {
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const rows = await this.prisma.contactDetailRejection.findMany({
      where: { createdAt: { gte: week } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
    });
    return rows;
  }

  // Users with ≥3 rejections in the last 7 days — ban-candidate set.
  // Uses a groupBy because we want one row per user with their
  // aggregate count, not 1 row per rejection.
  async repeatOffenders(minCount = 3): Promise<RepeatOffender[]> {
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const grouped = await this.prisma.contactDetailRejection.groupBy({
      by: ['userId'],
      where: {
        userId: { not: null },
        createdAt: { gte: week },
      },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { id: 'desc' } },
      having: {
        id: { _count: { gte: minCount } },
      },
      take: 50,
    });

    if (grouped.length === 0) return [];

    const userIds = grouped
      .map((g) => g.userId)
      .filter((id): id is string => id !== null);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return grouped
      .filter((g): g is typeof g & { userId: string } => g.userId !== null)
      .map((g) => {
        const u = byId.get(g.userId);
        return {
          userId: g.userId,
          username: u?.username ?? null,
          email: u?.email ?? '(unknown)',
          rejectionCount: g._count._all,
          lastRejectionAt: g._max.createdAt ?? new Date(0),
        };
      });
  }

  // ── User-initiated reports (Phase 3) ─────────────────────────────
  // Listing + seller reports land as AdminAlert rows (LISTING_REPORTED /
  // SELLER_REPORTED). Surface the unresolved ones, joined to the subject.
  async reportedListings(): Promise<
    {
      id: string;
      reason: string;
      createdAt: Date;
      listing: { id: string; title: string } | null;
    }[]
  > {
    const alerts = await this.prisma.adminAlert.findMany({
      where: { type: 'LISTING_REPORTED', resolved: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const ids = alerts
      .map((a) => a.referenceId)
      .filter((x): x is string => !!x);
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));
    return alerts.map((a) => ({
      id: a.id,
      reason: parseReason(a.context),
      createdAt: a.createdAt,
      listing: a.referenceId ? (byId.get(a.referenceId) ?? null) : null,
    }));
  }

  async reportedSellers(): Promise<
    {
      id: string;
      reason: string;
      createdAt: Date;
      seller: { id: string; username: string | null; email: string } | null;
    }[]
  > {
    const alerts = await this.prisma.adminAlert.findMany({
      where: { type: 'SELLER_REPORTED', resolved: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const ids = alerts
      .map((a) => a.referenceId)
      .filter((x): x is string => !!x);
    const sellers = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, email: true },
    });
    const byId = new Map(sellers.map((s) => [s.id, s]));
    return alerts.map((a) => ({
      id: a.id,
      reason: parseReason(a.context),
      createdAt: a.createdAt,
      seller: a.referenceId ? (byId.get(a.referenceId) ?? null) : null,
    }));
  }

  // Reported Q&A — any listing question with reportedCount > 0.
  // Newest first. Capped at 50 because reports are infrequent.
  async reportedQuestions(): Promise<ReportedQuestion[]> {
    return this.prisma.listingQuestion.findMany({
      where: { reportedCount: { gt: 0 } },
      orderBy: [{ reportedCount: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        question: true,
        reportedCount: true,
        status: true,
        createdAt: true,
        listing: { select: { id: true, title: true } },
        asker: { select: { username: true } },
      },
    });
  }
}
