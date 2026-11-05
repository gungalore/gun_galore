import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LegalSearchHit {
  id: string;
  sourceSlug: string;
  sourceTitle: string;
  documentType: string;
  citation: string;
  sectionNumber: string;
  heading: string | null;
  chapter: string | null;
  part: string | null;
  snippet: string;
  rank: number;
}

export interface LegalProvisionRecord {
  id: string;
  sourceSlug: string;
  sourceTitle: string;
  documentType: string;
  citation: string;
  sectionNumber: string;
  heading: string | null;
  chapter: string | null;
  part: string | null;
  text: string;
}

/**
 * Fast retrieval over the indexed legal corpus.
 *
 * ⚠️ POSTGRES DOES THE RANKING. `searchTsv` is a generated weighted tsvector
 * (section number + heading at A, citation at B, body at C) and the query uses
 * `websearch_to_tsquery`, so "section 16 dedicated hunter" behaves like a
 * search box rather than a brittle substring match. `ts_headline` returns the
 * matching slice for the UI/agent without shipping a whole regulation.
 */
@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    query: string,
    opts: { source?: string; limit?: number } = {},
  ): Promise<LegalSearchHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const source = opts.source?.trim() || null;
    const limit = Math.max(1, Math.min(50, opts.limit ?? 10));

    return this.prisma.$queryRaw<LegalSearchHit[]>`
      SELECT
        p."id",
        s."slug" AS "sourceSlug",
        s."title" AS "sourceTitle",
        p."documentType",
        p."citation",
        p."sectionNumber",
        p."heading",
        p."chapter",
        p."part",
        ts_headline(
          'english',
          p."text",
          websearch_to_tsquery('english', ${q}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=45, MinWords=18'
        ) AS "snippet",
        ts_rank_cd(p."searchTsv", websearch_to_tsquery('english', ${q})) AS "rank"
      FROM "LegalProvision" p
      JOIN "LegalSource" s ON s."id" = p."sourceId"
      WHERE p."searchTsv" @@ websearch_to_tsquery('english', ${q})
        AND (${source}::text IS NULL OR s."slug" = ${source})
      ORDER BY "rank" DESC, p."ordinal" ASC
      LIMIT ${limit}
    `;
  }

  async section(
    sourceSlug: string,
    sectionNumber: string,
  ): Promise<LegalProvisionRecord[]> {
    return this.prisma.$queryRaw<LegalProvisionRecord[]>`
      SELECT
        p."id",
        s."slug" AS "sourceSlug",
        s."title" AS "sourceTitle",
        p."documentType",
        p."citation",
        p."sectionNumber",
        p."heading",
        p."chapter",
        p."part",
        p."text"
      FROM "LegalProvision" p
      JOIN "LegalSource" s ON s."id" = p."sourceId"
      WHERE s."slug" = ${sourceSlug}
        AND p."sectionNumber" = ${sectionNumber}
      ORDER BY p."ordinal" ASC
    `;
  }

  async sources() {
    return this.prisma.legalSource.findMany({
      orderBy: { title: 'asc' },
      select: {
        slug: true,
        title: true,
        shortTitle: true,
        citation: true,
        documentType: true,
        version: true,
        effectiveDate: true,
        licence: true,
        sourceUrl: true,
        _count: { select: { provisions: true } },
      },
    });
  }
}
