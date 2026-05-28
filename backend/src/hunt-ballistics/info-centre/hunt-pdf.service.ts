import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  HuntPdfCategory,
  HuntPdfStatus,
  type HuntPdf,
  type HuntPdfPage,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * INFO Centre — knowledge base for the Hunt Ballistics iOS app.
 *
 * The operator curates a library of hunting reference PDFs (species
 * guides, cartridge data, regulations, theory books, flora references).
 * PDFs live on the operator's local machine; only the EXTRACTED TEXT
 * per page is stored on the backend — never the source PDF.
 *
 * Operator workflow:
 *   1. Drop a PDF in a local folder on the dev machine.
 *   2. Claude Code reads it (Max-plan covered), extracts text per page,
 *      optionally renders pages where layout matters.
 *   3. POST /admin/hunt-pdfs creates the metadata row.
 *   4. POST /admin/hunt-pdfs/:id/pages bulk-imports the page array.
 *   5. PATCH /admin/hunt-pdfs/:id moves status DRAFT → ACTIVE.
 *
 * Search flow at runtime:
 *   1. iOS app calls /info-centre/search?q=...
 *   2. Postgres FTS via websearch_to_tsquery against the tsvector
 *      generated column (see onModuleInit) returns ranked hits.
 *   3. App jumps to /info-centre/pdf/:id/page/:n for the reader.
 */
@Injectable()
export class HuntPdfService implements OnModuleInit {
  private readonly logger = new Logger(HuntPdfService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Add the FTS column + GIN index if missing. Idempotent — safe
    // to run on every boot. Same pattern as ReloadingService.
    try {
      await this.prisma.$executeRawUnsafe(`
        ALTER TABLE "HuntPdfPage"
          ADD COLUMN IF NOT EXISTS "textTsv" tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce("text", ''))) STORED;
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "HuntPdfPage_textTsv_idx"
          ON "HuntPdfPage" USING GIN ("textTsv");
      `);
      this.logger.log('HuntPdf FTS column + GIN index ensured');
    } catch (err) {
      this.logger.warn(
        `Failed to ensure HuntPdf FTS index (search will be slow until fixed): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // ─── Public read methods ─────────────────────────────────────────

  /**
   * Browse the full ACTIVE library, grouped by category, ordered
   * by sortOrder then title. Used by the INFO landing screen.
   */
  async listLibrary(): Promise<
    Array<{
      category: HuntPdfCategory;
      pdfs: Array<
        Pick<
          HuntPdf,
          | 'id'
          | 'title'
          | 'author'
          | 'edition'
          | 'publishedYear'
          | 'pageCount'
          | 'blurb'
          | 'language'
        >
      >;
    }>
  > {
    const all = await this.prisma.huntPdf.findMany({
      where: { status: HuntPdfStatus.ACTIVE },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        author: true,
        edition: true,
        publishedYear: true,
        pageCount: true,
        blurb: true,
        language: true,
        category: true,
      },
    });

    // Group by category, preserve order.
    const grouped = new Map<
      HuntPdfCategory,
      Array<(typeof all)[number]>
    >();
    for (const pdf of all) {
      const key = pdf.category;
      const list = grouped.get(key) ?? [];
      list.push(pdf);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries()).map(([category, pdfs]) => ({
      category,
      pdfs: pdfs.map(({ category: _c, ...rest }) => rest),
    }));
  }

  /**
   * Single PDF metadata + first-page snippet. Used by the PDF detail
   * screen (table-of-contents-ish view).
   */
  async getPdf(id: string): Promise<
    Pick<
      HuntPdf,
      | 'id'
      | 'title'
      | 'author'
      | 'edition'
      | 'publisher'
      | 'publishedYear'
      | 'category'
      | 'language'
      | 'pageCount'
      | 'blurb'
    >
  > {
    const pdf = await this.prisma.huntPdf.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        author: true,
        edition: true,
        publisher: true,
        publishedYear: true,
        category: true,
        language: true,
        pageCount: true,
        blurb: true,
        status: true,
      },
    });
    if (!pdf || pdf.status !== HuntPdfStatus.ACTIVE) {
      throw new NotFoundException('PDF not found.');
    }
    const { status: _status, ...publicFields } = pdf;
    return publicFields;
  }

  /**
   * Single page — text + optional rendered image. Used by the reader.
   */
  async getPage(
    pdfId: string,
    pageNumber: number,
  ): Promise<
    Pick<HuntPdfPage, 'pageNumber' | 'text' | 'imageBase64' | 'imageMime'> & {
      pdf: { id: string; title: string; pageCount: number };
    }
  > {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('pageNumber must be a positive integer.');
    }
    const pdf = await this.prisma.huntPdf.findUnique({
      where: { id: pdfId },
      select: { id: true, title: true, pageCount: true, status: true },
    });
    if (!pdf || pdf.status !== HuntPdfStatus.ACTIVE) {
      throw new NotFoundException('PDF not found.');
    }
    const page = await this.prisma.huntPdfPage.findUnique({
      where: { pdfId_pageNumber: { pdfId, pageNumber } },
      select: {
        pageNumber: true,
        text: true,
        imageBase64: true,
        imageMime: true,
      },
    });
    if (!page) {
      throw new NotFoundException(
        `Page ${pageNumber} not found in this PDF.`,
      );
    }
    const { status: _status, ...pdfPublic } = pdf;
    return { ...page, pdf: pdfPublic };
  }

  /**
   * Postgres FTS across all ACTIVE PDFs. Returns top hits with a
   * ~250-word snippet so the user can scan results and pick the
   * right page to open. Same pattern as ReloadingService.searchPages.
   */
  async searchPages(
    query: string,
    limit = 10,
  ): Promise<
    Array<{
      pdfId: string;
      pdfTitle: string;
      author: string | null;
      category: HuntPdfCategory;
      pageNumber: number;
      snippet: string;
      rank: number;
    }>
  > {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.max(1, Math.min(limit, 20));
    type Row = {
      pdfId: string;
      pdfTitle: string;
      author: string | null;
      category: HuntPdfCategory;
      pageNumber: number;
      snippet: string;
      rank: number;
    };
    return this.prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT
        m."id"          AS "pdfId",
        m."title"       AS "pdfTitle",
        m."author",
        m."category",
        p."pageNumber",
        ts_headline(
          'english',
          p."text",
          websearch_to_tsquery('english', $1),
          'MaxWords=250, MinWords=120, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "'
        ) AS "snippet",
        ts_rank(p."textTsv", websearch_to_tsquery('english', $1)) AS "rank"
      FROM "HuntPdfPage" p
      JOIN "HuntPdf" m ON m."id" = p."pdfId"
      WHERE m."status" = 'ACTIVE'
        AND p."textTsv" @@ websearch_to_tsquery('english', $1)
      ORDER BY "rank" DESC, m."sortOrder" ASC, m."title" ASC, p."pageNumber" ASC
      LIMIT $2;
      `,
      trimmed,
      safeLimit,
    );
  }

  // ─── Admin write methods ─────────────────────────────────────────

  /**
   * Create a new PDF row with metadata. Status defaults to DRAFT —
   * operator promotes to ACTIVE after importing pages.
   */
  async createPdf(input: {
    title: string;
    author?: string;
    edition?: string;
    publisher?: string;
    publishedYear?: number;
    category?: HuntPdfCategory;
    language?: string;
    blurb?: string;
    sortOrder?: number;
  }): Promise<HuntPdf> {
    if (!input.title || input.title.trim().length === 0) {
      throw new BadRequestException('title is required.');
    }
    return this.prisma.huntPdf.create({
      data: {
        title: input.title.trim().slice(0, 200),
        author: input.author?.trim().slice(0, 200) || null,
        edition: input.edition?.trim().slice(0, 100) || null,
        publisher: input.publisher?.trim().slice(0, 200) || null,
        publishedYear: input.publishedYear ?? null,
        category: input.category ?? HuntPdfCategory.GENERAL,
        language: input.language?.trim().slice(0, 10) || 'en',
        blurb: input.blurb?.trim().slice(0, 1000) || null,
        sortOrder: input.sortOrder ?? 100,
      },
    });
  }

  /**
   * Bulk-import pages from the operator's local PDF extraction.
   * Idempotent on (pdfId, pageNumber) — re-importing the same page
   * UPDATES the text + image. Also bumps the parent PDF's pageCount.
   */
  async importPages(
    pdfId: string,
    pages: Array<{
      pageNumber: number;
      text: string;
      imageBase64?: string;
      imageMime?: string;
    }>,
  ): Promise<{ inserted: number; updated: number; pageCount: number }> {
    const pdf = await this.prisma.huntPdf.findUnique({
      where: { id: pdfId },
      select: { id: true },
    });
    if (!pdf) throw new NotFoundException('PDF not found.');
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new BadRequestException('pages must be a non-empty array.');
    }

    // Validate each page before any DB writes so we fail cleanly.
    for (const p of pages) {
      if (!Number.isInteger(p.pageNumber) || p.pageNumber < 1) {
        throw new BadRequestException(
          `Invalid pageNumber: ${p.pageNumber} (must be positive integer).`,
        );
      }
      if (typeof p.text !== 'string') {
        throw new BadRequestException(
          `Invalid text on page ${p.pageNumber}.`,
        );
      }
    }

    let inserted = 0;
    let updated = 0;
    for (const p of pages) {
      const result = await this.prisma.huntPdfPage.upsert({
        where: {
          pdfId_pageNumber: { pdfId, pageNumber: p.pageNumber },
        },
        update: {
          text: p.text,
          imageBase64: p.imageBase64 ?? null,
          imageMime: p.imageMime ?? null,
        },
        create: {
          pdfId,
          pageNumber: p.pageNumber,
          text: p.text,
          imageBase64: p.imageBase64 ?? null,
          imageMime: p.imageMime ?? null,
        },
        select: { createdAt: true, id: true },
      });
      // Heuristic: if createdAt is within the last few seconds, it
      // was just inserted; otherwise it was updated. Good enough for
      // the import summary the operator sees.
      const isNew = Date.now() - result.createdAt.getTime() < 5000;
      if (isNew) inserted++;
      else updated++;
    }

    // Recompute pageCount from the actual page rows so it's always
    // accurate even if the operator re-imports a subset.
    const pageCount = await this.prisma.huntPdfPage.count({
      where: { pdfId },
    });
    await this.prisma.huntPdf.update({
      where: { id: pdfId },
      data: { pageCount },
    });

    return { inserted, updated, pageCount };
  }

  /**
   * Update PDF metadata (title, author, status, blurb, etc.). All
   * fields optional — pass only what changed.
   */
  async updatePdf(
    id: string,
    patch: {
      title?: string;
      author?: string | null;
      edition?: string | null;
      publisher?: string | null;
      publishedYear?: number | null;
      category?: HuntPdfCategory;
      language?: string;
      status?: HuntPdfStatus;
      blurb?: string | null;
      sortOrder?: number;
    },
  ): Promise<HuntPdf> {
    const exists = await this.prisma.huntPdf.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('PDF not found.');
    return this.prisma.huntPdf.update({
      where: { id },
      data: patch,
    });
  }

  /**
   * Delete a PDF and all its pages (cascade). Use with care — there's
   * no undo. Most operations should ARCHIVE via updatePdf instead.
   */
  async deletePdf(id: string): Promise<void> {
    await this.prisma.huntPdf.delete({ where: { id } });
  }
}
