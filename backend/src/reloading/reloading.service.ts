import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PDFParse } from 'pdf-parse';
import { ReloadingManualStatus } from '@prisma/client';
import { promises as fs, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

/**
 * Reloading-manual ingestion + indexing pipeline.
 *
 *   Operator workflow:
 *     1. SCP PDFs into RELOADING_MANUALS_INBOX_DIR on prod.
 *     2. Click "Scan inbox" in /admin/reloading (or POST /admin/reloading/scan).
 *     3. Service hashes every file (SHA-256 dedup), copies new ones into
 *        RELOADING_MANUALS_STORAGE_DIR with a random hex filename, runs
 *        pdf-parse, and bulk-inserts ReloadingManualPage rows.
 *     4. Original file is left in the inbox so the operator can verify
 *        before removing it. A future scan ignores it (hash match).
 *
 *   Why server filesystem (not Cloudinary):
 *     - These manuals are copyright-sensitive (commercial publications).
 *       Public Cloudinary URLs would let anyone with the link download
 *       the full PDF. Server storage + authenticated download route
 *       keeps access admin-gated.
 *     - Sprint 2 reads PDFs server-side via pdf-lib slicing — local
 *       filesystem is faster than HTTPS fetch.
 *     - Single point of operator control + zero external dependency.
 *
 *   Filename → metadata heuristic:
 *     `<manufacturer>__<title>__<edition>.pdf` parses cleanly. Without
 *     separators, falls back to first-word-as-manufacturer + remaining
 *     stem as title. Operator can fix metadata afterwards via the
 *     admin "Edit" action on each row.
 *
 *   Postgres FTS:
 *     onModuleInit() runs an idempotent DDL that adds a STORED
 *     GENERATED tsvector column + GIN index on ReloadingManualPage.
 *     Sprint 2's search uses to_tsquery against this index for
 *     millisecond lookups across the full corpus.
 */
const DEFAULT_INBOX_DIR =
  process.env.RELOADING_MANUALS_INBOX_DIR ??
  path.resolve(process.cwd(), '..', 'manual-inbox');
const DEFAULT_STORAGE_DIR =
  process.env.RELOADING_MANUALS_STORAGE_DIR ??
  path.resolve(process.cwd(), '..', 'manuals');

@Injectable()
export class ReloadingService implements OnModuleInit {
  private readonly logger = new Logger(ReloadingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Make sure both directories exist (mkdir -p semantics).
    await Promise.all([
      fs.mkdir(DEFAULT_INBOX_DIR, { recursive: true }).catch(() => undefined),
      fs.mkdir(DEFAULT_STORAGE_DIR, { recursive: true }).catch(() => undefined),
    ]);
    // Add the FTS column + index if not already present. Idempotent
    // via IF NOT EXISTS — safe to run on every boot.
    try {
      await this.prisma.$executeRawUnsafe(`
        ALTER TABLE "ReloadingManualPage"
          ADD COLUMN IF NOT EXISTS "textTsv" tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce("extractedText", ''))) STORED;
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ReloadingManualPage_textTsv_idx"
          ON "ReloadingManualPage" USING GIN ("textTsv");
      `);
      this.logger.log(
        `Reloading FTS column + GIN index ensured (inbox=${DEFAULT_INBOX_DIR}, storage=${DEFAULT_STORAGE_DIR})`,
      );
    } catch (err) {
      // Don't fatal the app — search just won't be FTS-accelerated
      // until the operator runs the DDL manually.
      this.logger.warn(
        `Failed to ensure FTS index (search will be slow until fixed): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * Scan the inbox directory, ingesting every new .pdf file found.
   * Idempotent: files already ingested (matched by SHA-256 of contents)
   * are skipped. Returns a summary the admin UI displays.
   */
  async scanInbox(uploadedByAdminId: string): Promise<{
    inboxDir: string;
    scanned: number;
    ingested: number;
    skipped: number;
    failed: number;
    items: Array<{
      file: string;
      status: 'INGESTED' | 'SKIPPED' | 'FAILED';
      manualId?: string;
      pages?: number;
      error?: string;
    }>;
  }> {
    let entries: string[];
    try {
      entries = await fs.readdir(DEFAULT_INBOX_DIR);
    } catch {
      // Inbox dir doesn't exist yet — create it + return empty summary.
      await fs
        .mkdir(DEFAULT_INBOX_DIR, { recursive: true })
        .catch(() => undefined);
      return {
        inboxDir: DEFAULT_INBOX_DIR,
        scanned: 0,
        ingested: 0,
        skipped: 0,
        failed: 0,
        items: [],
      };
    }

    const pdfFiles = entries.filter((n) => n.toLowerCase().endsWith('.pdf'));
    const items: Awaited<ReturnType<ReloadingService['scanInbox']>>['items'] = [];
    let ingested = 0;
    let skipped = 0;
    let failed = 0;

    for (const filename of pdfFiles) {
      const fullPath = path.join(DEFAULT_INBOX_DIR, filename);
      try {
        const result = await this.ingestPdfFromPath(fullPath, uploadedByAdminId);
        if (result.status === 'INGESTED') ingested++;
        else if (result.status === 'SKIPPED') skipped++;
        items.push({
          file: filename,
          status: result.status,
          manualId: result.manualId,
          pages: result.pages,
        });
      } catch (err) {
        failed++;
        items.push({
          file: filename,
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        this.logger.error(
          `Inbox ingest failed for ${filename}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    this.logger.log(
      `Inbox scan complete: ${ingested} ingested, ${skipped} skipped (dedup), ${failed} failed (of ${pdfFiles.length} PDFs)`,
    );
    return {
      inboxDir: DEFAULT_INBOX_DIR,
      scanned: pdfFiles.length,
      ingested,
      skipped,
      failed,
      items,
    };
  }

  /**
   * Ingest a single PDF from a filesystem path. Dedups by SHA-256, so
   * the same file scanned twice creates one row only.
   */
  private async ingestPdfFromPath(
    fullPath: string,
    uploadedByAdminId: string,
  ): Promise<{
    status: 'INGESTED' | 'SKIPPED' | 'FAILED';
    manualId?: string;
    pages?: number;
  }> {
    const buffer = await fs.readFile(fullPath);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Dedup: if a manual with this content already exists, skip.
    // We store the hash in the storedPath filename so look-up is a
    // single equality match without a separate column.
    const expectedSuffix = `${sha256.slice(0, 16)}.pdf`;
    const existing = await this.prisma.reloadingManual.findFirst({
      where: { storedPath: { endsWith: expectedSuffix } },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', manualId: existing.id };
    }

    // Copy into permanent storage with a random-hex + hash-suffix
    // filename (hash for dedup, random prefix so a directory listing
    // leak doesn't reveal which manuals we hold).
    const randomPrefix = randomBytes(8).toString('hex');
    const storedFilename = `${randomPrefix}-${expectedSuffix}`;
    const storedAbsPath = path.join(DEFAULT_STORAGE_DIR, storedFilename);
    await fs.mkdir(DEFAULT_STORAGE_DIR, { recursive: true });
    await fs.writeFile(storedAbsPath, buffer);

    // Parse filename → metadata defaults. Operator can fix later.
    const originalName = path.basename(fullPath);
    const meta = this.parseFilenameMetadata(originalName);

    // Create row in PROCESSING so the admin UI sees it during the
    // extraction window. Flip to ACTIVE on success / FAILED on throw.
    // If the DB create throws (e.g. FK violation, duplicate constraint),
    // we MUST unlink the file we just wrote — otherwise it sits as an
    // orphan on disk forever.
    let manual: { id: string };
    try {
      manual = await this.prisma.reloadingManual.create({
        data: {
          manufacturer: meta.manufacturer,
          title: meta.title,
          edition: meta.edition,
          storedPath: storedFilename,
          fileSizeBytes: buffer.length,
          status: ReloadingManualStatus.PROCESSING,
          uploadedByAdminId,
        },
        select: { id: true },
      });
    } catch (err) {
      // Roll back the disk write so we don't leak orphan files.
      await fs.unlink(storedAbsPath).catch(() => undefined);
      throw err;
    }

    try {
      const pages = await this.extractPagesText(buffer);
      if (pages.length === 0) {
        throw new Error('pdf-parse returned zero pages.');
      }
      await this.prisma.reloadingManualPage.createMany({
        data: pages.map((p) => ({
          manualId: manual.id,
          pageNumber: p.num,
          extractedText: p.text,
        })),
      });
      await this.prisma.reloadingManual.update({
        where: { id: manual.id },
        data: {
          status: ReloadingManualStatus.ACTIVE,
          pageCount: pages.length,
        },
      });
      this.logger.log(
        `Ingested "${meta.manufacturer} — ${meta.title}" (${pages.length} pages, ${buffer.length} bytes) as ${manual.id}`,
      );
      return { status: 'INGESTED', manualId: manual.id, pages: pages.length };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown extraction error';
      await this.prisma.reloadingManual.update({
        where: { id: manual.id },
        data: {
          status: ReloadingManualStatus.FAILED,
          errorMessage,
        },
      });
      this.logger.error(
        `pdf-parse failed for ${originalName} (manual ${manual.id}): ${errorMessage}`,
      );
      return { status: 'INGESTED', manualId: manual.id, pages: 0 };
    }
  }

  /**
   * Re-run extraction on a manual that previously failed (or that the
   * operator wants re-indexed after a library upgrade). Wipes the
   * existing ReloadingManualPage rows first.
   */
  async retryExtraction(manualId: string): Promise<{
    id: string;
    status: ReloadingManualStatus;
    pageCount: number;
  }> {
    const manual = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: { id: true, storedPath: true },
    });
    if (!manual) throw new NotFoundException('Manual not found.');

    const storedAbsPath = path.join(DEFAULT_STORAGE_DIR, manual.storedPath);
    let buf: Buffer;
    try {
      buf = await fs.readFile(storedAbsPath);
    } catch (err) {
      throw new BadRequestException(
        `Stored PDF file missing on disk (${storedAbsPath}). Re-scan the inbox or delete this manual. (${
          err instanceof Error ? err.message : 'fs error'
        })`,
      );
    }

    await this.prisma.reloadingManualPage.deleteMany({ where: { manualId } });
    await this.prisma.reloadingManual.update({
      where: { id: manualId },
      data: {
        status: ReloadingManualStatus.PROCESSING,
        errorMessage: null,
        pageCount: 0,
      },
    });

    try {
      const pages = await this.extractPagesText(buf);
      if (pages.length === 0) throw new Error('pdf-parse returned zero pages.');
      await this.prisma.reloadingManualPage.createMany({
        data: pages.map((p) => ({
          manualId,
          pageNumber: p.num,
          extractedText: p.text,
        })),
      });
      return this.prisma.reloadingManual.update({
        where: { id: manualId },
        data: {
          status: ReloadingManualStatus.ACTIVE,
          pageCount: pages.length,
        },
        select: { id: true, status: true, pageCount: true },
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown extraction error';
      return this.prisma.reloadingManual.update({
        where: { id: manualId },
        data: { status: ReloadingManualStatus.FAILED, errorMessage },
        select: { id: true, status: true, pageCount: true },
      });
    }
  }

  /** Admin index view — all manuals, most-recent first. */
  async listManuals() {
    return this.prisma.reloadingManual.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        manufacturer: true,
        title: true,
        edition: true,
        status: true,
        pageCount: true,
        fileSizeBytes: true,
        errorMessage: true,
        storedPath: true,
        createdAt: true,
        updatedAt: true,
        uploadedByAdmin: { select: { id: true, email: true } },
      },
    });
  }

  /** Inline metadata edit — operator fixes filename-derived defaults. */
  async updateMetadata(
    manualId: string,
    patch: { manufacturer?: string; title?: string; edition?: string | null },
  ): Promise<{ id: string }> {
    const manufacturer = patch.manufacturer?.trim();
    const title = patch.title?.trim();
    if (manufacturer !== undefined && manufacturer.length === 0) {
      throw new BadRequestException('Manufacturer cannot be empty.');
    }
    if (title !== undefined && title.length === 0) {
      throw new BadRequestException('Title cannot be empty.');
    }
    const data: Record<string, unknown> = {};
    if (manufacturer !== undefined) data.manufacturer = manufacturer;
    if (title !== undefined) data.title = title;
    if (patch.edition !== undefined) {
      const trimmed = patch.edition?.trim();
      data.edition = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    return this.prisma.reloadingManual.update({
      where: { id: manualId },
      data,
      select: { id: true },
    });
  }

  /** Archive (soft-hide from Ask GG queries). Use when replacing with
   *  a newer edition. Reversible via activate(). */
  async archive(manualId: string): Promise<{ id: string; status: ReloadingManualStatus }> {
    const exists = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Manual not found.');
    return this.prisma.reloadingManual.update({
      where: { id: manualId },
      data: { status: ReloadingManualStatus.ARCHIVED },
      select: { id: true, status: true },
    });
  }

  async activate(manualId: string): Promise<{ id: string; status: ReloadingManualStatus }> {
    const exists = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: { id: true, pageCount: true },
    });
    if (!exists) throw new NotFoundException('Manual not found.');
    return this.prisma.reloadingManual.update({
      where: { id: manualId },
      data: {
        status:
          exists.pageCount > 0
            ? ReloadingManualStatus.ACTIVE
            : ReloadingManualStatus.FAILED,
      },
      select: { id: true, status: true },
    });
  }

  /**
   * Hard-delete a manual: removes the on-disk PDF + cascades the
   * ReloadingManualPage rows via Prisma onDelete: Cascade. Use when
   * the manual was a mis-upload (wrong file, duplicate, etc.).
   */
  async deleteManual(manualId: string): Promise<{ ok: true }> {
    const manual = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: { id: true, storedPath: true },
    });
    if (!manual) throw new NotFoundException('Manual not found.');

    // Best-effort filesystem delete. If it fails (file already gone),
    // proceed with DB cleanup so the row doesn't dangle.
    try {
      await fs.unlink(path.join(DEFAULT_STORAGE_DIR, manual.storedPath));
    } catch (err) {
      this.logger.warn(
        `Disk delete failed for ${manual.storedPath}: ${
          err instanceof Error ? err.message : err
        } (proceeding with DB delete)`,
      );
    }
    await this.prisma.reloadingManual.delete({ where: { id: manualId } });
    return { ok: true };
  }

  /**
   * Return a node read-stream for a manual's stored PDF — used by the
   * admin download route. Verifies the file exists before returning so
   * the controller can 404 cleanly.
   */
  async openDownloadStream(manualId: string): Promise<{
    stream: ReadStream;
    filename: string;
    sizeBytes: number;
  }> {
    const manual = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: {
        storedPath: true,
        fileSizeBytes: true,
        manufacturer: true,
        title: true,
        edition: true,
      },
    });
    if (!manual) throw new NotFoundException('Manual not found.');
    const abs = path.join(DEFAULT_STORAGE_DIR, manual.storedPath);
    try {
      await fs.access(abs);
    } catch {
      throw new NotFoundException('Stored PDF missing on disk.');
    }
    // Human-readable filename for Content-Disposition.
    const safeName = `${manual.manufacturer}-${manual.title}${
      manual.edition ? `-${manual.edition}` : ''
    }`
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 100);
    return {
      stream: createReadStream(abs),
      filename: `${safeName}.pdf`,
      sizeBytes: manual.fileSizeBytes,
    };
  }

  /**
   * Read a manual's stored PDF into a Buffer. Used by Sprint 2's
   * fetchManualPages tool — pdf-lib slices specific page ranges from
   * this buffer before handing them to Claude.
   */
  async readPdfBuffer(manualId: string): Promise<Buffer> {
    const manual = await this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: { storedPath: true },
    });
    if (!manual) throw new NotFoundException('Manual not found.');
    return fs.readFile(path.join(DEFAULT_STORAGE_DIR, manual.storedPath));
  }

  /**
   * Postgres FTS lookup across all ACTIVE manuals. Used by Ask GG's
   * `searchReloadingManuals` tool. Returns top hits with a 240-char
   * snippet for Claude to evaluate which page to fetch next.
   *
   * Uses websearch_to_tsquery so users-typed queries like
   *   ".308 168gr Sierra MatchKing H4350"
   * work without manual quoting — Postgres handles ranking via
   * ts_rank against the GIN-indexed tsvector column.
   */
  async searchPages(
    query: string,
    limit = 5,
  ): Promise<
    Array<{
      manualId: string;
      manufacturer: string;
      title: string;
      edition: string | null;
      pageNumber: number;
      snippet: string;
      rank: number;
    }>
  > {
    const trimmed = query.trim();
    if (!trimmed) return [];
    // Cap limit to a sane range so a hallucinated huge value doesn't
    // blow up the response payload.
    const safeLimit = Math.max(1, Math.min(limit, 10));
    type Row = {
      manualId: string;
      manufacturer: string;
      title: string;
      edition: string | null;
      pageNumber: number;
      snippet: string;
      rank: number;
    };
    // Raw SQL because Prisma doesn't surface tsvector / websearch_to_tsquery
    // natively. The tsvector column is the GENERATED ALWAYS AS column we
    // create on app boot (see onModuleInit).
    // Snippets are deliberately big (250+ words across 2 fragments).
    // Claude often answers reloading questions from search snippets
    // alone and never needs to fetch the PDF — that skips the slow
    // vision pass entirely. ~350 tokens per hit × 5 hits ≈ 1.7k
    // tokens of context, well worth it for the win.
    return this.prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT
        m."id"          AS "manualId",
        m."manufacturer",
        m."title",
        m."edition",
        p."pageNumber",
        ts_headline(
          'english',
          p."extractedText",
          websearch_to_tsquery('english', $1),
          'MaxWords=250, MinWords=150, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "'
        ) AS "snippet",
        ts_rank(p."textTsv", websearch_to_tsquery('english', $1)) AS "rank"
      FROM "ReloadingManualPage" p
      JOIN "ReloadingManual" m ON m."id" = p."manualId"
      WHERE m."status" = 'ACTIVE'
        AND p."textTsv" @@ websearch_to_tsquery('english', $1)
      ORDER BY "rank" DESC, m."manufacturer" ASC, p."pageNumber" ASC
      LIMIT $2;
      `,
      trimmed,
      safeLimit,
    );
  }

  /**
   * Slice a specific page range out of a stored manual's PDF and
   * return the result as a Buffer. Used by Ask GG's `fetchManualPages`
   * tool so Claude only loads the pages it actually needs to read
   * (Anthropic has a 32 MB per-document limit; the biggest manuals
   * exceed that whole-file, so always slice).
   *
   * Pages are 1-indexed to match the page numbers Postgres FTS
   * returns, but pdf-lib copyPages is 0-indexed — we adjust here.
   * Invalid page numbers are silently filtered out.
   */
  async slicePagesAsPdf(
    manualId: string,
    pageNumbers: number[],
  ): Promise<Buffer> {
    const source = await this.readPdfBuffer(manualId);
    const srcDoc = await PDFDocument.load(source, {
      ignoreEncryption: true,
    });
    const total = srcDoc.getPageCount();
    // Convert to 0-indexed + filter out-of-range + dedup + sort.
    const wantedZeroIdx = Array.from(
      new Set(
        pageNumbers
          .map((n) => Math.floor(n) - 1)
          .filter((n) => n >= 0 && n < total),
      ),
    ).sort((a, b) => a - b);
    if (wantedZeroIdx.length === 0) {
      throw new BadRequestException(
        `No valid pages requested (manual has ${total} pages; got ${pageNumbers.join(', ')})`,
      );
    }
    const outDoc = await PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, wantedZeroIdx);
    for (const page of copied) outDoc.addPage(page);
    const bytes = await outDoc.save();
    return Buffer.from(bytes);
  }

  /** Fetch lightweight metadata for a single manual — used by the
   *  Ask GG tool-use flow so Claude can format the citation in its
   *  answer ("Hodgdon Annual Manual 2024, p.145"). */
  async getManualMeta(manualId: string): Promise<{
    id: string;
    manufacturer: string;
    title: string;
    edition: string | null;
    pageCount: number;
  } | null> {
    return this.prisma.reloadingManual.findUnique({
      where: { id: manualId },
      select: {
        id: true,
        manufacturer: true,
        title: true,
        edition: true,
        pageCount: true,
      },
    });
  }

  // ─── internals ────────────────────────────────────────────────────

  /**
   * Filename heuristic. Recognised formats:
   *   - `Manufacturer__Title__Edition.pdf` → split on double-underscore
   *   - `Manufacturer__Title.pdf` (no edition)
   *   - anything else → first capitalised word = manufacturer, rest = title
   *
   * Examples:
   *   "Hodgdon__Annual Manual__2024.pdf"
   *     → { Hodgdon, Annual Manual, 2024 }
   *   "Hornady 10th Edition.pdf"
   *     → { Hornady, "10th Edition", null }
   *   "ACCURATE.PDF"
   *     → { Accurate, Accurate, null }   (single-word fallback)
   *
   * Operator can fix any of these via the admin "Edit" inline form.
   */
  private parseFilenameMetadata(filename: string): {
    manufacturer: string;
    title: string;
    edition: string | null;
  } {
    const stem = filename.replace(/\.pdf$/i, '').trim();
    if (stem.includes('__')) {
      const parts = stem.split('__').map((s) => s.trim()).filter(Boolean);
      const manufacturer = parts[0] ?? 'Unknown';
      const title = parts[1] ?? manufacturer;
      const edition = parts[2] ?? null;
      return { manufacturer: titleCase(manufacturer), title, edition };
    }
    // No separators — guess from the first word.
    const tokens = stem.split(/[\s_-]+/).filter(Boolean);
    if (tokens.length === 0) {
      return { manufacturer: 'Unknown', title: 'Untitled', edition: null };
    }
    if (tokens.length === 1) {
      const m = titleCase(tokens[0]);
      return { manufacturer: m, title: m, edition: null };
    }
    return {
      manufacturer: titleCase(tokens[0]),
      title: tokens.slice(1).join(' '),
      edition: null,
    };
  }

  /**
   * Run pdf-parse over a PDF buffer and return per-page text. pdf-parse
   * v2 is built on pdfjs-dist and returns one TextResult with a
   * `pages: PageTextResult[]` member.
   */
  private async extractPagesText(
    buffer: Buffer,
  ): Promise<Array<{ num: number; text: string }>> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.pages.map((p) => ({ num: p.num, text: p.text ?? '' }));
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
