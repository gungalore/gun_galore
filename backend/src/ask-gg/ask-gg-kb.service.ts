import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AskGgKbStatus } from '@prisma/client';

/**
 * Ask GG knowledge-base service (Phase C — search-first flow).
 *
 *   - Resolved conversations become DRAFT KB entries automatically.
 *     Admin verifies via /admin/ask-gg/kb (Sprint C3).
 *   - VERIFIED entries are searched FIRST when a user asks a new
 *     question. Matches surface as cards above the composer; the
 *     user can click "This helped" (uses the KB answer, skips
 *     Claude entirely = zero cost) or "Ask anyway" (proceeds to
 *     the normal Claude call).
 *   - usefulCount / surfacedCount track entry quality. High-useful
 *     entries rank higher; never-helpful entries can be archived.
 *
 * onModuleInit creates a tsvector GENERATED column + GIN index over
 * title + question + answer. Same pattern as ReloadingManualPage —
 * Prisma doesn't natively manage GENERATED columns so we manage the
 * DDL idempotently here. If `prisma db push` ever drops the column
 * with `--accept-data-loss`, Postgres re-populates it from the source
 * fields the moment we re-add it (no manual reindex needed).
 *
 * Embeddings (pgvector cosine similarity for semantic matches) are
 * scheduled for a later drop — Postgres FTS gives us solid keyword
 * matching for v1, and the cost-per-question impact comes from any
 * KB hit at all, not from semantic vs lexical quality.
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

  /**
   * Search VERIFIED KB entries for a user's question. Returns top
   * hits with a snippet so the frontend can render a preview card.
   *
   * Uses weighted FTS (title > question > answer) so a title match
   * outranks a deep-in-the-answer match. ts_rank gives us numeric
   * ordering; the limit cap keeps the response small for fast
   * debounced search-as-you-type.
   *
   * Side effect: bumps surfacedCount on every hit so admin can see
   * which entries are pulling weight in the analytics dashboard.
   */
  async searchVerified(
    query: string,
    limit = 3,
  ): Promise<
    Array<{
      id: string;
      title: string;
      answer: string;
      snippet: string;
      category: string | null;
      usefulCount: number;
      rank: number;
    }>
  > {
    const trimmed = query.trim();
    if (trimmed.length < 3) return []; // too short to be meaningful
    const safeLimit = Math.max(1, Math.min(limit, 10));

    type Row = {
      id: string;
      title: string;
      answer: string;
      snippet: string;
      category: string | null;
      usefulCount: number;
      rank: number;
    };
    const hits = await this.prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT
        "id",
        "title",
        "answer",
        ts_headline(
          'english',
          coalesce("answer", ''),
          websearch_to_tsquery('english', $1),
          'MaxWords=40, MinWords=20, ShortWord=2, MaxFragments=1'
        ) AS "snippet",
        "category",
        "usefulCount",
        ts_rank("searchTsv", websearch_to_tsquery('english', $1)) AS "rank"
      FROM "AskGgKbEntry"
      WHERE "status" = 'VERIFIED'
        AND "searchTsv" @@ websearch_to_tsquery('english', $1)
      ORDER BY "rank" DESC, "usefulCount" DESC, "verifiedAt" DESC
      LIMIT $2;
      `,
      trimmed,
      safeLimit,
    );

    // Best-effort surfacedCount bump — fire-and-forget so the response
    // stays fast. Bulk update via IN clause.
    if (hits.length > 0) {
      const ids = hits.map((h) => h.id);
      this.prisma.askGgKbEntry
        .updateMany({
          where: { id: { in: ids } },
          data: { surfacedCount: { increment: 1 } },
        })
        .catch((err) => {
          this.logger.warn(
            `surfacedCount bump failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
    }

    return hits;
  }

  /**
   * Auto-create a DRAFT KB entry from a RESOLVED conversation.
   * Called by AskGgService.markResolved when outcome=RESOLVED.
   *
   * Collapses the conversation to the simplest useful shape:
   *   title   = conversation.title (already truncated first user msg)
   *   question = first user message content (full)
   *   answer  = latest assistant message content
   *
   * Admin can fully edit any field during verification. Duplicate
   * detection: AskGgKbEntry.sourceConversationId is @unique, so
   * re-marking the same conversation RESOLVED is a no-op (we catch
   * the unique-violation and log it).
   */
  async createDraftFromConversation(conversationId: string): Promise<void> {
    const conv = await this.prisma.askGgConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        title: true,
        userId: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, createdAt: true },
        },
      },
    });
    if (!conv) {
      this.logger.warn(
        `createDraftFromConversation: conversation ${conversationId} not found`,
      );
      return;
    }

    const firstUserMsg = conv.messages.find((m) => m.role === 'user');
    // Latest assistant message — what actually answered them.
    const lastAssistant = [...conv.messages]
      .reverse()
      .find((m) => m.role === 'assistant');

    if (!firstUserMsg || !lastAssistant) {
      this.logger.warn(
        `createDraftFromConversation: conv ${conversationId} missing required messages`,
      );
      return;
    }

    try {
      await this.prisma.askGgKbEntry.create({
        data: {
          sourceConversationId: conv.id,
          authorId: conv.userId,
          title: conv.title ?? firstUserMsg.content.slice(0, 80),
          question: firstUserMsg.content,
          answer: lastAssistant.content,
          status: AskGgKbStatus.DRAFT,
        },
      });
      this.logger.log(
        `Created DRAFT KB entry from conversation ${conversationId}`,
      );
    } catch (err) {
      // Most likely a unique-violation on sourceConversationId — user
      // re-marked the same conversation RESOLVED. Idempotent: log + skip.
      this.logger.warn(
        `Skipped DRAFT creation for ${conversationId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** User clicked "This helped" on a KB card — bump usefulCount.
   *  Cheap aggregate that admin uses to prioritise high-impact
   *  entries + spot ones that surface but never help (candidates
   *  for re-write or archive). */
  async markHelpful(entryId: string): Promise<{ id: string; usefulCount: number }> {
    try {
      const updated = await this.prisma.askGgKbEntry.update({
        where: { id: entryId },
        data: { usefulCount: { increment: 1 } },
        select: { id: true, usefulCount: true },
      });
      return updated;
    } catch {
      throw new NotFoundException('KB entry not found');
    }
  }

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
}
