import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AskGgKbStatus } from '@prisma/client';

/**
 * Ask GG knowledge-base service — the desk's own help content.
 *
 * ⚠️ NOW AN ADMIN-ONLY STORE (retired 2026-09-07). The KB was built for
 * the chat's search-first flow: a resolved conversation became a DRAFT
 * entry, an admin verified it, and a VERIFIED entry then surfaced as a
 * card above the composer so a matching question cost nothing to answer.
 * The chat is gone, so the whole read path went with it. What is left is
 * the verification queue and the verified-expert grants, both of which
 * the desk still uses.
 *
 * onModuleInit creates a tsvector GENERATED column + GIN index over
 * title + question + answer. Same pattern as ReloadingManualPage —
 * Prisma doesn't natively manage GENERATED columns so we manage the
 * DDL idempotently here. If `prisma db push` ever drops the column
 * with `--accept-data-loss`, Postgres re-populates it from the source
 * fields the moment we re-add it (no manual reindex needed).
 */
@Injectable()
export class AskGgKbService implements OnModuleInit {
  private readonly logger = new Logger(AskGgKbService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        ALTER TABLE "AskGgKbEntry"
          ADD COLUMN IF NOT EXISTS "searchTsv" tsvector
          GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
            setweight(to_tsvector('english', coalesce("question", '')), 'B') ||
            setweight(to_tsvector('english', coalesce("answer", '')), 'C')
          ) STORED;
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "AskGgKbEntry_searchTsv_idx"
          ON "AskGgKbEntry" USING GIN ("searchTsv");
      `);
      this.logger.log('AskGg KB FTS column + GIN index ensured');
    } catch (err) {
      this.logger.warn(
        `Failed to ensure KB FTS index (search will fall back to LIKE until fixed): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ⚠️ THE READ PATH IS GONE (retired 2026-09-07). searchVerified(),
  // createDraftFromConversation() and markHelpful() served the chat: the
  // KB cards above the composer, the "This helped" counter, and the
  // RESOLVED-conversation-becomes-a-DRAFT pipeline. The chat came off the
  // site on 2026-08-26 and its backend a fortnight later, so nothing reads
  // an entry and nothing creates one automatically any more — the desk
  // writes and curates them by hand through the admin routes below.
  //
  // The FTS column above STAYS. It is a GENERATED column Prisma does not
  // manage (see the schema-drift trap in CLAUDE.md); it exists in
  // production, the DDL is idempotent, and dropping it here would be a
  // silent schema change on boot rather than a cleanup.

  // ─── Admin operations (Sprint C3) ────────────────────────────────

  /** List KB entries, newest first. Optional status filter — defaults
   *  to DRAFT-only so the admin queue is naturally focused. */
  async adminList(opts: {
    status?: AskGgKbStatus;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const where = opts.status ? { status: opts.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.askGgKbEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          question: true,
          answer: true,
          category: true,
          tags: true,
          status: true,
          usefulCount: true,
          surfacedCount: true,
          verifiedAt: true,
          createdAt: true,
          sourceConversationId: true,
          author: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.askGgKbEntry.count({ where }),
    ]);
    // Counts by status give the admin a queue depth chip at the top.
    const statusCounts = await this.prisma.askGgKbEntry.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts = {
      DRAFT: 0,
      VERIFIED: 0,
      SUBMITTED: 0,
      ARCHIVED: 0,
    } as Record<AskGgKbStatus, number>;
    for (const c of statusCounts) counts[c.status] = c._count._all;
    return { rows, total, limit, offset, counts };
  }

  /** Edit KB entry fields — used during admin curation before
   *  verifying. Operator can fix the auto-collapsed title /
   *  question / answer text and set category + tags. */
  async adminUpdate(
    id: string,
    patch: {
      title?: string;
      question?: string;
      answer?: string;
      category?: string | null;
      tags?: string[];
    },
  ) {
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title.trim();
    if (patch.question !== undefined) data.question = patch.question.trim();
    if (patch.answer !== undefined) data.answer = patch.answer.trim();
    if (patch.category !== undefined) {
      const trimmed = patch.category?.trim();
      data.category = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    if (patch.tags !== undefined) data.tags = patch.tags;
    try {
      return await this.prisma.askGgKbEntry.update({
        where: { id },
        data,
        select: { id: true, title: true, status: true },
      });
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

  /** Verify a DRAFT (or re-verify) — flips status to VERIFIED and
   *  stamps verifiedById/verifiedAt. The entry is now searched by
   *  the user-facing search-first flow. */
  async adminVerify(id: string, adminUserId: string) {
    try {
      return await this.prisma.askGgKbEntry.update({
        where: { id },
        data: {
          status: AskGgKbStatus.VERIFIED,
          verifiedById: adminUserId,
          verifiedAt: new Date(),
        },
        select: { id: true, status: true, verifiedAt: true },
      });
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

  /** Archive — soft-delete. Hidden from search, kept in DB so we
   *  preserve audit + can un-archive if the operator changes their
   *  mind. */
  async adminArchive(id: string) {
    try {
      return await this.prisma.askGgKbEntry.update({
        where: { id },
        data: { status: AskGgKbStatus.ARCHIVED },
        select: { id: true, status: true },
      });
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

  /** Un-archive — flip ARCHIVED back to DRAFT so admin can re-review,
   *  edit, and verify. (Not directly back to VERIFIED — the operator
   *  should opt in deliberately.) */
  async adminUnarchive(id: string) {
    try {
      return await this.prisma.askGgKbEntry.update({
        where: { id },
        data: { status: AskGgKbStatus.DRAFT },
        select: { id: true, status: true },
      });
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

  /** Hard delete — for mis-collapsed conversations that shouldn't
   *  even be a draft. Logged via AdminAuditService at the controller
   *  layer so we know who pulled the trigger. */
  async adminDelete(id: string): Promise<{ ok: true }> {
    try {
      await this.prisma.askGgKbEntry.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

  // ─── Verified-Expert eligibility (Phase E1) ──────────────────────
  //
  // OD2 locked: hybrid criteria — a user becomes "expert eligible"
  // once they've authored 5+ VERIFIED KB entries. Admin still has to
  // approve (mandatory reason → AdminAuditEvent). This service is the
  // read side; the actual grant/revoke happens via AdminService.
  //
  // We deliberately do NOT auto-promote — five solid contributions
  // doesn't necessarily mean the rest of the user's posture is good
  // (could be a banned-pending user, or someone whose listings have a
  // pattern of disputes). The admin sees the eligibility queue,
  // checks the user, then decides.

  /** Threshold for expert eligibility (5 verified KB entries — OD2
   *  locked). Exposed so the admin queue page can render
   *  "N / 5 verified" progress for in-flight contributors too. */
  readonly EXPERT_VERIFIED_THRESHOLD = 5;

  /** How many verified KB entries does this user have? Cheap count
   *  query — used by the user's own progress chip + by the admin
   *  dossier. */
  async getVerifiedKbCount(userId: string): Promise<number> {
    return this.prisma.askGgKbEntry.count({
      where: { authorId: userId, status: AskGgKbStatus.VERIFIED },
    });
  }

  /** Snapshot for a single user — what their badge state is and
   *  whether they're eligible. Used by /admin/users/:id dossier
   *  panel + the public /sellers/:userId render. */
  async getExpertEligibility(userId: string): Promise<{
    userId: string;
    verifiedKbCount: number;
    threshold: number;
    eligible: boolean;
    isVerifiedExpert: boolean;
    verifiedExpertAt: Date | null;
    expertBadgeReason: string | null;
  }> {
    const [user, verifiedKbCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isVerifiedExpert: true,
          verifiedExpertAt: true,
          expertBadgeReason: true,
        },
      }),
      this.getVerifiedKbCount(userId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    return {
      userId,
      verifiedKbCount,
      threshold: this.EXPERT_VERIFIED_THRESHOLD,
      eligible: verifiedKbCount >= this.EXPERT_VERIFIED_THRESHOLD,
      isVerifiedExpert: user.isVerifiedExpert,
      verifiedExpertAt: user.verifiedExpertAt,
      expertBadgeReason: user.expertBadgeReason,
    };
  }

  /** Admin queue — every user who's contributed ≥5 verified KB
   *  entries AND doesn't already hold the badge. Newest-contribution
   *  first so the admin sees fresh activity at the top.
   *
   *  Returns a single round-trip with the per-user verified count +
   *  the user's username/email so the admin can sanity-check before
   *  approving. We also include the most recent verified entry's
   *  date as a proxy for "is this still an active contributor". */
  async getExpertQueue(opts: { limit?: number; offset?: number } = {}): Promise<{
    rows: Array<{
      userId: string;
      verifiedKbCount: number;
      mostRecentVerifiedAt: Date | null;
      user: {
        id: string;
        username: string | null;
        email: string;
        firstName: string | null;
        lastName: string | null;
      };
    }>;
    total: number;
  }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const offset = Math.max(0, opts.offset ?? 0);

    // groupBy gives us per-author counts in one query — much cheaper
    // than per-user N+1. We then filter to ≥ threshold and join in
    // the user row.
    const grouped = await this.prisma.askGgKbEntry.groupBy({
      by: ['authorId'],
      where: { status: AskGgKbStatus.VERIFIED },
      _count: { _all: true },
      _max: { verifiedAt: true },
    });

    // Keep users at-or-above threshold AND not already badged.
    const eligibleAuthorIds = grouped
      .filter((g) => g._count._all >= this.EXPERT_VERIFIED_THRESHOLD)
      .map((g) => g.authorId);

    if (eligibleAuthorIds.length === 0) {
      return { rows: [], total: 0 };
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: eligibleAuthorIds },
        // Not-yet-badged only. Already-granted users show on the
        // separate "granted" tab via getGrantedExperts().
        isVerifiedExpert: false,
      },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const rows = grouped
      .filter((g) => userById.has(g.authorId))
      .sort((a, b) => {
        const ad = a._max.verifiedAt?.getTime() ?? 0;
        const bd = b._max.verifiedAt?.getTime() ?? 0;
        return bd - ad;
      })
      .slice(offset, offset + limit)
      .map((g) => ({
        userId: g.authorId,
        verifiedKbCount: g._count._all,
        mostRecentVerifiedAt: g._max.verifiedAt,
        user: userById.get(g.authorId)!,
      }));

    return { rows, total: users.length };
  }

  /** Already-granted experts — sibling tab so admin can revoke
   *  without searching the user table. Includes the reason that
   *  was given at grant time. */
  async getGrantedExperts(opts: { limit?: number; offset?: number } = {}): Promise<{
    rows: Array<{
      userId: string;
      verifiedKbCount: number;
      verifiedExpertAt: Date | null;
      expertBadgeReason: string | null;
      user: {
        id: string;
        username: string | null;
        email: string;
        firstName: string | null;
        lastName: string | null;
      };
    }>;
    total: number;
  }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { isVerifiedExpert: true },
        orderBy: [{ verifiedExpertAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          verifiedExpertAt: true,
          expertBadgeReason: true,
        },
      }),
      this.prisma.user.count({ where: { isVerifiedExpert: true } }),
    ]);

    // Per-user verified-KB count. N+1 is fine — granted experts will
    // never be many (5+ verified contributors who get manually
    // approved by a human admin); not worth optimising into a single
    // SQL query yet.
    const rows = await Promise.all(
      users.map(async (u) => ({
        userId: u.id,
        verifiedKbCount: await this.getVerifiedKbCount(u.id),
        verifiedExpertAt: u.verifiedExpertAt,
        expertBadgeReason: u.expertBadgeReason,
        user: {
          id: u.id,
          username: u.username,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
        },
      })),
    );
    return { rows, total };
  }

  /** Mutate verified-expert state. Returns the updated user fields
   *  the admin UI needs to refresh the row in place. Audit is
   *  recorded by the controller (uniform pattern). */
  async setVerifiedExpert(
    userId: string,
    grant: boolean,
    reason: string,
  ): Promise<{
    id: string;
    isVerifiedExpert: boolean;
    verifiedExpertAt: Date | null;
    expertBadgeReason: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: grant
        ? {
            isVerifiedExpert: true,
            verifiedExpertAt: new Date(),
            expertBadgeReason: reason.trim().slice(0, 500),
          }
        : {
            isVerifiedExpert: false,
            verifiedExpertAt: null,
            // Keep the reason as historical context — the admin
            // audit log has the revoke reason separately.
          },
      select: {
        id: true,
        isVerifiedExpert: true,
        verifiedExpertAt: true,
        expertBadgeReason: true,
      },
    });
    return updated;
  }
}
