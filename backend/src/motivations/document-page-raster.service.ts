import { Injectable, Logger } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import {
  ANNEXURE_PAGE_SCALE,
  PRINT_PAGE_SCALE,
  rasterisePdfToDir,
} from './pdf-raster';

// ────────────────────────────────────────────────────────────────────
// AN UPLOADED PDF, AS IMAGES.
//
// ⚠️ ONE DOCUMENT TYPE FOR EVERY ANNEXURE. pdfkit draws a JPEG or a PNG
// anywhere in the flow; it cannot place a PDF page except at a page boundary,
// so PDF annexures used to be spliced in by pdf-lib afterwards — all of them at
// the same spot near the back, never in their letter's position, and with the
// contents numbering to match. Rasterising the page removes the second type
// from the annexures entirely: a PDF annexure becomes the same kind of picture
// as a photographed one and goes through the same planner, the same captions
// and the same letter order.
//
// ⚠️ RASTERISED ONCE, THEN REUSED. Rendering happens on EVERY download, and
// the rasteriser is a child process that takes seconds and can crash. Paying
// that per download, for every PDF in the pack, would make a download slow and
// a crash more likely. The page images are cached on the sha256 of the SOURCE
// bytes, so the same municipal bill attached to two applications, or a vault
// document adopted twice, is rasterised once.
//
// ⚠️ FAIL-SOFT IN EVERY DIRECTION. A rasteriser that fails, a cache that
// cannot be read, a store that cannot be written: each costs at most that one
// document, which the caller then lists as "bring your own copy". None of them
// may cost the pack.
// ────────────────────────────────────────────────────────────────────

/**
 * Bump when the rasteriser's OUTPUT could change for bytes it has seen.
 *
 * ⚠️ IN THE CACHE KEY, LIKE DocumentReadCache's READER_VERSION. A change to
 * the scale, the encoder or the child's rendering must invalidate what it
 * replaces the day it ships, not whenever a TTL happens to lapse.
 */
export const PAGE_RASTER_VERSION = '2026-09-15';

/**
 * The PRINT-and-OCR variant's cache version. Distinct from the annexure
 * version because the two render the same bytes at different scales and
 * qualities — sharing a version would let one overwrite the other in cache.
 */
export const PRINT_PAGE_RASTER_VERSION = '2026-10-01';

/** Thirty days, matching DocumentReadCache: this is the document itself. */
const TTL_DAYS = 30;

/** JPEG quality for a stored page. High enough to read a serial number. */
const PAGE_JPEG_QUALITY = 82;

/** Print-grade JPEG quality — see PRINT_PAGE_SCALE in pdf-raster.ts. */
const PRINT_JPEG_QUALITY = 90;

/** Which render a caller wants: the size-minded annexure, or print fidelity. */
export type PageRender = 'annexure' | 'print';

function renderConfig(render: PageRender): {
  scale: number;
  quality: number;
  version: string;
} {
  return render === 'print'
    ? { scale: PRINT_PAGE_SCALE, quality: PRINT_JPEG_QUALITY, version: PRINT_PAGE_RASTER_VERSION }
    : { scale: ANNEXURE_PAGE_SCALE, quality: PAGE_JPEG_QUALITY, version: PAGE_RASTER_VERSION };
}

export interface RasteredPage {
  /** 1-based page number in the source document. */
  page: number;
  bytes: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class DocumentPageRasterService {
  private readonly logger = new Logger(DocumentPageRasterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
  ) {}

  /**
   * Every page of a PDF as an image, in order.
   *
   * ⚠️ AN EMPTY ARRAY IS A FAILED DOCUMENT, NOT AN EMPTY ONE. Every failure
   * path returns `[]`, and the caller reads that as "we could not reprint this"
   * — which is why nothing here throws.
   */
  async pagesFor(input: {
    bytes: Buffer;
    sha256: string;
    /** Defaults to the annexure render; 'print' is 300 dpi / q90. */
    render?: PageRender;
  }): Promise<RasteredPage[]> {
    const cfg = renderConfig(input.render ?? 'annexure');
    const cached = await this.readCache(input.sha256, cfg.version);
    if (cached) return cached;
    try {
      return await this.rasteriseAndStore(input, cfg);
    } catch (err) {
      this.logger.warn(
        `Rasterising a PDF annexure failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Forget every page image rasterised from these bytes.
   *
   * ⚠️ CALLED WHEN THE SOURCE DOCUMENT IS DELETED, and that is a privacy
   * obligation rather than housekeeping — the same one DocumentReadCache
   * honours. A page image is a faithful copy of somebody's licence; a delete
   * that left it behind would be a lie.
   */
  async forget(fileSha256: string): Promise<number> {
    try {
      const rows = await this.prisma.documentPageImage.findMany({
        where: { fileSha256 },
        select: { storageKey: true },
      });
      if (!rows.length) return 0;
      await this.prisma.documentPageImage.deleteMany({ where: { fileSha256 } });
      for (const row of rows) {
        await this.files.remove(row.storageKey).catch(() => undefined);
      }
      return rows.length;
    } catch (err) {
      this.logger.warn(
        `Page image purge failed for one document: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Forget every page image rasterised from any of these documents.
   *
   * ⚠️ THE RETENTION SWEEP'S DOOR. See the note on
   * DocumentReadCacheService.forgetMany: the sweep nulls rows in a batch and
   * had no sha256 to give `forget`, so the page images — which ARE the
   * document, not a note about it — outlived the bytes they came from. An
   * erasure had the same hole.
   */
  async forgetMany(fileSha256s: readonly string[]): Promise<number> {
    const sha = fileSha256s.filter(Boolean);
    if (!sha.length) return 0;
    try {
      const rows = await this.prisma.documentPageImage.findMany({
        where: { fileSha256: { in: sha as string[] } },
        select: { storageKey: true },
      });
      if (!rows.length) return 0;
      await this.prisma.documentPageImage.deleteMany({
        where: { fileSha256: { in: sha as string[] } },
      });
      for (const row of rows) {
        await this.files.remove(row.storageKey).catch(() => undefined);
      }
      return rows.length;
    } catch (err) {
      this.logger.warn(
        `Page image purge failed for ${sha.length} document(s): ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /** Drop what has expired, bytes and all. Called by the retention sweep. */
  async purgeExpired(): Promise<number> {
    try {
      const rows = await this.prisma.documentPageImage.findMany({
        where: { expiresAt: { lte: new Date() } },
        select: { storageKey: true },
      });
      if (!rows.length) return 0;
      const { count } = await this.prisma.documentPageImage.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      for (const row of rows) {
        await this.files.remove(row.storageKey).catch(() => undefined);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `Page image expiry sweep failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * A previous rasterisation of these exact bytes, or null.
   *
   * ⚠️ A MISSING OR UNREADABLE FILE IS A MISS, NOT A PARTIAL HIT. Half a
   * document is worse than none: the annexure would print with pages silently
   * missing, and nobody would know which. Anything wrong here falls through to
   * a fresh rasterisation.
   */
  private async readCache(
    fileSha256: string,
    rendererVersion: string,
  ): Promise<RasteredPage[] | null> {
    try {
      const rows = await this.prisma.documentPageImage.findMany({
        where: {
          fileSha256,
          rendererVersion,
          expiresAt: { gt: new Date() },
        },
        orderBy: { page: 'asc' },
        select: { page: true, storageKey: true, width: true, height: true },
      });
      if (!rows.length) return null;
      const pages: RasteredPage[] = [];
      for (const row of rows) {
        const bytes = await this.files.read(row.storageKey);
        pages.push({
          page: row.page,
          bytes,
          width: row.width,
          height: row.height,
        });
      }
      return pages;
    } catch (err) {
      this.logger.warn(
        `Page image cache lookup failed, rasterising instead: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Rasterise every page in the child process, then store and remember them. */
  private async rasteriseAndStore(
    input: {
      bytes: Buffer;
      sha256: string;
    },
    cfg: { scale: number; quality: number; version: string },
  ): Promise<RasteredPage[]> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'doc-pages-'));
    try {
      const inPath = path.join(dir, 'document.pdf');
      await writeFile(inPath, input.bytes);
      const count = await rasterisePdfToDir(inPath, dir, cfg.scale);

      const pages: RasteredPage[] = [];
      const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
      for (let page = 1; page <= count; page++) {
        const raw = await readFile(path.join(dir, `page-${page}.png`));
        const jpeg = await sharp(raw)
          .jpeg({ quality: cfg.quality })
          .toBuffer();
        const { width, height } = await sharp(jpeg).metadata();
        if (!width || !height) continue;
        pages.push({ page, bytes: jpeg, width, height });
      }
      if (!pages.length)
        throw new Error('the document produced no usable page');

      // ⚠️ STORED AFTER THE WHOLE DOCUMENT RASTERISED, NOT PAGE BY PAGE. A
      // crash halfway through the child would otherwise leave a partial
      // document cached, and the next download would print the first two pages
      // of a bank statement as though that were all of it.
      for (const page of pages) {
        const stored = await this.files.write(
          'motivations',
          page.bytes,
          new Date(),
        );
        await this.prisma.documentPageImage.upsert({
          where: {
            fileSha256_page_rendererVersion: {
              fileSha256: input.sha256,
              page: page.page,
              rendererVersion: cfg.version,
            },
          },
          create: {
            fileSha256: input.sha256,
            page: page.page,
            rendererVersion: cfg.version,
            storageKey: stored.storageKey,
            mimeType: 'image/jpeg',
            width: page.width,
            height: page.height,
            byteSize: stored.byteSize,
            expiresAt,
          },
          update: {
            storageKey: stored.storageKey,
            mimeType: 'image/jpeg',
            width: page.width,
            height: page.height,
            byteSize: stored.byteSize,
            renderedAt: new Date(),
            expiresAt,
          },
        });
      }
      return pages;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
