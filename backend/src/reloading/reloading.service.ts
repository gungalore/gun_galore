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

/**
 * Spell-error / alias mitigation for reloading queries.
 *
 * Maps common misspellings + shorthand of powder names and brand
 * proper-nouns to the canonical spelling used in the manuals. Applied
 * case-insensitively, token-by-token, in normalizeQuery(). Unknown
 * words pass through unchanged. Keys MUST be lower-case (the lookup
 * lower-cases each token before matching). Extend freely — it's a
 * simple flat lookup, no precedence rules.
 *
 * Two query passes use this:
 *   1. before building the websearch tsquery (so "hornaday" → "Hornady"
 *      matches the indexed token), and
 *   2. before the pg_trgm fuzzy fallback (the trgm catches the long
 *      tail of typos this map doesn't enumerate).
 */
const RELOADING_ALIAS_MAP: Record<string, string> = {
  // ── Brands ───────────────────────────────────────────────────────
  hornaday: 'Hornady',
  hornady: 'Hornady',
  hornidy: 'Hornady',
  hornandy: 'Hornady',
  vihtoviori: 'Vihtavuori',
  vihtavouri: 'Vihtavuori',
  vihtavuori: 'Vihtavuori',
  vihta: 'Vihtavuori',
  vit: 'Vihtavuori',
  vihtevouri: 'Vihtavuori',
  hodgson: 'Hodgdon',
  hodgdson: 'Hodgdon',
  hogdon: 'Hodgdon',
  hodgdon: 'Hodgdon',
  hodgdonreloadingmanual: 'Hodgdon',
  layman: 'Lyman',
  lyman: 'Lyman',
  somchen: 'Somchem',
  somchem: 'Somchem',
  somchemm: 'Somchem',
  sierra: 'Sierra',
  siera: 'Sierra',
  sierraa: 'Sierra',
  serria: 'Sierra',
  nosler: 'Nosler',
  noslar: 'Nosler',
  nossler: 'Nosler',
  barnes: 'Barnes',
  barns: 'Barnes',
  barness: 'Barnes',
  alliant: 'Alliant',
  aliant: 'Alliant',
  alliantt: 'Alliant',
  imr: 'IMR',
  // ── Powders ──────────────────────────────────────────────────────
  varget: 'Varget',
  vargit: 'Varget',
  h4350: 'H4350',
  'h-4350': 'H4350',
  hh4350: 'H4350',
  h4831: 'H4831',
  'h-4831': 'H4831',
  h1000: 'H1000',
  'h-1000': 'H1000',
  h335: 'H335',
  'h-335': 'H335',
  cfe223: 'CFE223',
  'cfe-223': 'CFE223',
  benchmark: 'Benchmark',
  benchmrk: 'Benchmark',
  n140: 'N140',
  n150: 'N150',
  n160: 'N160',
  n133: 'N133',
  n550: 'N550',
  s321: 'S321',
  s335: 'S335',
  s341: 'S341',
  s365: 'S365',
  mp200: 'MP200',
  tac: 'TAC',
};

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

    // pg_trgm fuzzy-match support — powers the typo-tolerant fallback in
    // searchPages() when the primary FTS query returns nothing. Each
    // statement is wrapped independently: CREATE EXTENSION can fail on a
    // role without the SUPERUSER/createrole privilege, but the GIN index
    // is still worth attempting if the extension already exists. Neither
    // failure is fatal — the fuzzy fallback just won't fire.
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to ensure pg_trgm extension (fuzzy search disabled): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ReloadingManualPage_extractedText_trgm_idx"
          ON "ReloadingManualPage" USING GIN ("extractedText" gin_trgm_ops);
      `);
    } catch (err) {
      this.logger.warn(
        `Failed to ensure pg_trgm GIN index (fuzzy search will be slow): ${
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
   * Normalise a user query before it becomes a tsquery.
   *
   * Two passes:
   *   1. Collapse spaced powder-code forms ("h 4350" → "h4350",
   *      "cfe 223" → "cfe223", "n 140" → "n140") so the next pass can
   *      look them up as a single token.
   *   2. Token-by-token alias replacement via RELOADING_ALIAS_MAP
   *      (case-insensitive). Unknown words pass through unchanged.
   *
   * Punctuation that matters to load-data queries (`.308`, `.30-06`,
   * `6.5`) is preserved — we only split on whitespace, never on dots
   * or hyphens, so calibre designations stay intact.
   */
  normalizeQuery(q: string): string {
    const collapsed = q
      // "h 4350" / "h-4350"(handled by map) → "h4350"; bounded so we
      // don't merge across unrelated words. Letter(s)+space+3-4 digits.
      .replace(/\b([a-zA-Z]{1,3})\s+(\d{3,4})\b/g, '$1$2')
      // "cfe 223" → "cfe223"
      .replace(/\bcfe\s+(\d{2,3})\b/gi, 'cfe$1');
    return collapsed
      .split(/(\s+)/) // keep the whitespace delimiters so spacing survives
      .map((tok) => {
        if (/^\s+$/.test(tok) || tok.length === 0) return tok;
        const alias = RELOADING_ALIAS_MAP[tok.toLowerCase()];
        return alias ?? tok;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Postgres FTS lookup across all ACTIVE manuals. Used by Ask GG's
   * `searchReloadingManuals` tool. Returns top hits with a big snippet
   * for Claude to evaluate which page to fetch next.
   *
   * Uses websearch_to_tsquery so user-typed queries like
   *   ".308 168gr Sierra MatchKing H4350"
   * work without manual quoting — Postgres handles ranking via
   * ts_rank against the GIN-indexed tsvector column.
   *
   * Three robustness layers sit in front of the raw FTS:
   *   - normalizeQuery() rewrites known powder/brand misspellings to
   *     their canonical spelling.
   *   - BULLET-WEIGHT TOLERANCE: a "180gr" in the query is expanded to
   *     also match 175..185gr load data (charges are listed per exact
   *     weight; nearby weights are useful reference).
   *   - pg_trgm FUZZY FALLBACK: if the primary FTS returns 0 rows, a
   *     trigram-similarity pass catches typos the alias map missed.
   */
  async searchPages(
    query: string,
    limit = 5,
  ): Promise<{
    results: Array<{
      manualId: string;
      manufacturer: string;
      title: string;
      edition: string | null;
      pageNumber: number;
      snippet: string;
      rank: number;
      ocr: boolean;
    }>;
    /** Detected target bullet weight (grains), if the query had one. */
    weight: number | null;
    /** Inclusive ±5gr tolerance window applied for that weight. */
    weightWindow: [number, number] | null;
    /** True when the primary FTS returned nothing and the pg_trgm
     *  fuzzy fallback supplied these results instead. */
    fuzzy: boolean;
  }> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [], weight: null, weightWindow: null, fuzzy: false };
    }
    // Alias / spell-error normalisation FIRST — everything downstream
    // operates on the canonical spelling.
    const normalized = this.normalizeQuery(trimmed) || trimmed;
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
      ocr: boolean;
    };

    // ── BULLET-WEIGHT DETECTION ──────────────────────────────────────
    // Match 180gr / 180 gr / 180grain / 180 grain / 180gn. Capture the
    // 2-3 digit integer; only realistic bullet weights (30..600gr).
    const weightRegex = /\b(\d{2,3})\s?(?:gr(?:ains?|s)?|gn|grains?)\b/gi;
    const detectedWeights: number[] = [];
    let weightMatch: RegExpExecArray | null;
    // Track the exact matched substrings so we can strip them from the
    // base terms (the weight is handled by its own dedicated tsquery).
    const matchedWeightTokens: string[] = [];
    while ((weightMatch = weightRegex.exec(normalized)) !== null) {
      const w = parseInt(weightMatch[1], 10);
      if (w >= 30 && w <= 600) {
        detectedWeights.push(w);
        matchedWeightTokens.push(weightMatch[0]);
      }
    }
    // Use the FIRST realistic weight as the primary target for the
    // tolerance window we report back to the caller. (Multiple weights
    // are rare; all detected weights still feed the OR'd weight query.)
    const targetWeight = detectedWeights.length > 0 ? detectedWeights[0] : null;
    const weightWindow: [number, number] | null =
      targetWeight !== null
        ? [targetWeight - 5, targetWeight + 5]
        : null;

    // ── tsquery CONSTRUCTION ─────────────────────────────────────────
    // Base = the normalized query with the matched weight tokens stripped
    // out (whatever the user typed minus "180gr" etc.). We feed the base
    // through websearch_to_tsquery as a PARAMETER ($1) — no raw user text
    // ever enters a to_tsquery() string. The weight tsquery is built only
    // from validated integers + a whitelist of grain suffixes, so it's
    // safe to interpolate.
    let baseText = normalized;
    for (const tok of matchedWeightTokens) {
      baseText = baseText.split(tok).join(' ');
    }
    baseText = baseText.replace(/\s+/g, ' ').trim();

    // For each detected weight N, expand to the inclusive set N-5..N+5
    // and build the OR'd variant string. Variants per integer V:
    //   Vgr  (single token)
    //   V <-> gr / V <-> grain / V <-> grains / V <-> gn  (phrase forms)
    // SUFFIX_WHITELIST is fixed; V is a validated integer — no injection
    // surface in the to_tsquery() string.
    const SUFFIX_WHITELIST = ['gr', 'grain', 'grains', 'gn'] as const;
    const weightVariantClauses: string[] = [];
    if (detectedWeights.length > 0) {
      const expanded = new Set<number>();
      for (const w of detectedWeights) {
        for (let v = w - 5; v <= w + 5; v++) {
          if (v >= 1 && v <= 9999) expanded.add(v);
        }
      }
      for (const v of expanded) {
        // single fused token, e.g. 180gr
        weightVariantClauses.push(`${v}gr`);
        for (const suffix of SUFFIX_WHITELIST) {
          // phrase form, e.g. 180 <-> gr
          weightVariantClauses.push(`${v} <-> ${suffix}`);
        }
      }
    }

    // ── PRIMARY QUERY ────────────────────────────────────────────────
    // If a weight was detected, AND (&&) the base websearch query with a
    // to_tsquery built from the validated weight variants. Otherwise it's
    // the plain websearch query, identical to the original behaviour.
    let primaryRows: Row[];
    if (weightVariantClauses.length > 0) {
      // OR all weight variants together. Built purely from validated
      // ints + whitelisted suffixes (see above), so no user text reaches
      // to_tsquery — safe.
      const weightTsqueryStr = weightVariantClauses.join(' | ');
      // Combined predicate: base (param $1) && weights (param $2).
      // Both compiled server-side; the base stays parameterised.
      primaryRows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT
          m."id"          AS "manualId",
          m."manufacturer",
          m."title",
          m."edition",
          m."ocr",
          p."pageNumber",
          ts_headline(
            'english',
            p."extractedText",
            websearch_to_tsquery('english', $1) && to_tsquery('english', $2),
            'MaxWords=250, MinWords=150, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "'
          ) AS "snippet",
          ts_rank(
            p."textTsv",
            websearch_to_tsquery('english', $1) && to_tsquery('english', $2)
          ) AS "rank"
        FROM "ReloadingManualPage" p
        JOIN "ReloadingManual" m ON m."id" = p."manualId"
        WHERE m."status" = 'ACTIVE'
          AND p."textTsv" @@ (
            websearch_to_tsquery('english', $1) && to_tsquery('english', $2)
          )
        ORDER BY "rank" DESC, m."manufacturer" ASC, p."pageNumber" ASC
        LIMIT $3;
        `,
        // The base may be empty if the user typed ONLY a weight; an empty
        // websearch_to_tsquery is the "match anything" identity under &&,
        // which is exactly what we want (just the weight constraint).
        baseText,
        weightTsqueryStr,
        safeLimit,
      );
    } else {
      // No weight detected — behave exactly as the original search did,
      // just on the normalized query string + the new ocr column.
      primaryRows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT
          m."id"          AS "manualId",
          m."manufacturer",
          m."title",
          m."edition",
          m."ocr",
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
        normalized,
        safeLimit,
      );
    }

    if (primaryRows.length > 0) {
      return {
        results: primaryRows.map((r) => ({ ...r, ocr: Boolean(r.ocr) })),
        weight: targetWeight,
        weightWindow,
        fuzzy: false,
      };
    }

    // ── FUZZY FALLBACK (pg_trgm) ─────────────────────────────────────
    // Primary FTS found nothing. Catch typos the alias map didn't cover
    // via trigram word-similarity. word_similarity(query, text) > 0.3
    // finds pages where some run of words is close to the query. The
    // snippet falls back to plainto_tsquery (websearch can return an
    // empty query for short fuzzy input; plainto is more forgiving).
    // If pg_trgm isn't installed this throws — caught so search degrades
    // to "no hits" rather than erroring the whole tool call.
    let fuzzyRows: Row[] = [];
    try {
      fuzzyRows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT
          m."id"          AS "manualId",
          m."manufacturer",
          m."title",
          m."edition",
          m."ocr",
          p."pageNumber",
          ts_headline(
            'english',
            p."extractedText",
            plainto_tsquery('english', $1),
            'MaxWords=250, MinWords=150, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "'
          ) AS "snippet",
          word_similarity($1, p."extractedText") AS "rank"
        FROM "ReloadingManualPage" p
        JOIN "ReloadingManual" m ON m."id" = p."manualId"
        WHERE m."status" = 'ACTIVE'
          AND word_similarity($1, p."extractedText") > 0.3
        ORDER BY "rank" DESC, m."manufacturer" ASC, p."pageNumber" ASC
        LIMIT $2;
        `,
        normalized,
        safeLimit,
      );
    } catch (err) {
      this.logger.warn(
        `pg_trgm fuzzy fallback failed (extension missing?): ${
          err instanceof Error ? err.message : err
        }`,
      );
      fuzzyRows = [];
    }

    return {
      results: fuzzyRows.map((r) => ({ ...r, ocr: Boolean(r.ocr) })),
      weight: targetWeight,
      weightWindow,
      fuzzy: fuzzyRows.length > 0,
    };
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
