/**
 * OCR BACKFILL — standalone, NOT wired into app boot.
 *
 * Re-extracts page text from reloading-manual PDFs using Anthropic
 * vision OCR, for manuals where pdf-parse produced nothing (scanned /
 * image-only PDFs land with zero non-empty extractedText rows). The
 * transcribed text is written back into ReloadingManualPage and the
 * manual is flagged ocr=true + status ACTIVE so Ask GG can search it.
 *
 *   Usage:
 *     npx ts-node src/reloading/scripts/ocr-backfill.ts            # all needy ACTIVE manuals
 *     npx ts-node src/reloading/scripts/ocr-backfill.ts <id> <id>  # specific manual ids
 *
 *   Env:
 *     DATABASE_URL                 — Postgres connection (required)
 *     ANTHROPIC_API_KEY            — Claude key (required)
 *     ANTHROPIC_MODEL_JUDGE        — model override (default claude-sonnet-4-6)
 *     RELOADING_MANUALS_STORAGE_DIR — manuals dir (default ../manuals, mirrors the service)
 *     OCR_CHUNK_PAGES              — pages per Claude call (default 15)
 *
 * Idempotent + resumable PER MANUAL: each manual's pages are
 * delete+recreated in one pass (mirrors ReloadingService.retryExtraction).
 * Re-running re-OCRs from scratch — safe, just re-spends tokens. Each
 * manual is wrapped in try/catch so one failure doesn't abort the rest.
 *
 * DOES NOT touch prod unless DATABASE_URL points there. Read the cost
 * note it logs before running across the whole library.
 */
import 'dotenv/config';
import { PrismaClient, ReloadingManualStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const STORAGE_DIR =
  process.env.RELOADING_MANUALS_STORAGE_DIR ??
  path.resolve(process.cwd(), '..', 'manuals');
const MODEL = process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';
const CHUNK_PAGES = Math.max(
  1,
  parseInt(process.env.OCR_CHUNK_PAGES ?? '15', 10) || 15,
);

// Rough Sonnet pricing (USD per MTok) for the cost note only.
const PRICE_INPUT_PER_MTOK = 3;
const PRICE_OUTPUT_PER_MTOK = 15;

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY is not set. Aborting.');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface OcrPage {
  page: number;
  text: string;
}

/** Slice a contiguous 1-indexed page range out of a source PDF buffer. */
async function sliceChunk(
  srcBuffer: Buffer,
  startPage1: number,
  endPage1: number,
): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(srcBuffer, { ignoreEncryption: true });
  const total = srcDoc.getPageCount();
  const zeroIdx: number[] = [];
  for (let p = startPage1; p <= endPage1 && p <= total; p++) {
    zeroIdx.push(p - 1);
  }
  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, zeroIdx);
  for (const page of copied) outDoc.addPage(page);
  const bytes = await outDoc.save();
  return Buffer.from(bytes);
}

/** Extract the first balanced JSON array from a text blob. */
function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in model output.');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * OCR a single chunk PDF. `firstPage1` is the absolute 1-indexed page
 * number of the first page in the chunk, so we can ask Claude to return
 * ABSOLUTE page numbers.
 */
async function ocrChunk(
  chunkBuffer: Buffer,
  firstPage1: number,
  pageCountInChunk: number,
): Promise<{ pages: OcrPage[]; inputTokens: number; outputTokens: number }> {
  const lastPage1 = firstPage1 + pageCountInChunk - 1;
  const base64 = chunkBuffer.toString('base64');

  const instruction = `You are transcribing pages from a reloading manual for a full-text search index.

This document chunk contains ${pageCountInChunk} page(s). They correspond to ABSOLUTE page numbers ${firstPage1} through ${lastPage1} in the full manual (the first page in this chunk is page ${firstPage1}).

Transcribe the text of EACH page VERBATIM:
- Preserve load-data TABLES as readable text. Keep columns aligned with spaces or simple delimiters so powder, charge weights, velocities, pressures and COAL stay associated with the right row. Do NOT summarise or round numbers — copy them exactly.
- Include headers, footnotes, and captions.
- If a page is blank or unreadable, return an empty string for its text.

Return STRICT JSON ONLY — no markdown fence, no preamble — an array of objects:
[{"page": <absolute 1-indexed page number>, "text": "<verbatim transcription>"}, ...]

Use the ABSOLUTE page numbers (${firstPage1}..${lastPage1}), one object per page, in order.`;

  const r = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          { type: 'text', text: instruction },
        ],
      },
    ],
  });

  const textBlock = r.content.find((b) => b.type === 'text');
  const raw =
    textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
  const parsed = extractJsonArray(raw) as Array<{ page?: unknown; text?: unknown }>;
  const pages: OcrPage[] = parsed
    .map((row) => ({
      page: Number(row.page),
      text: typeof row.text === 'string' ? row.text : String(row.text ?? ''),
    }))
    .filter(
      (row) =>
        Number.isInteger(row.page) &&
        row.page >= firstPage1 &&
        row.page <= lastPage1,
    );

  return {
    pages,
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
  };
}

/** Backfill one manual end-to-end. Throws on fatal error (caught by caller). */
async function backfillManual(manualId: string): Promise<void> {
  const manual = await prisma.reloadingManual.findUnique({
    where: { id: manualId },
    select: {
      id: true,
      manufacturer: true,
      title: true,
      storedPath: true,
    },
  });
  if (!manual) {
    console.warn(`  [skip] manual ${manualId} not found.`);
    return;
  }
  const label = `${manual.manufacturer} — ${manual.title}`;
  const abs = path.join(STORAGE_DIR, manual.storedPath);

  let srcBuffer: Buffer;
  try {
    srcBuffer = await fs.readFile(abs);
  } catch (err) {
    throw new Error(
      `Stored PDF missing on disk (${abs}): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  const srcDoc = await PDFDocument.load(srcBuffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  console.log(`\n=== OCR "${label}" (${manualId}) — ${totalPages} pages ===`);

  // Mark PROCESSING up front so the admin UI reflects the in-flight state.
  await prisma.reloadingManual.update({
    where: { id: manualId },
    data: { status: ReloadingManualStatus.PROCESSING, errorMessage: null },
  });

  const allPages: OcrPage[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let start = 1; start <= totalPages; start += CHUNK_PAGES) {
    const end = Math.min(start + CHUNK_PAGES - 1, totalPages);
    const count = end - start + 1;
    console.log(`  chunk pages ${start}-${end} (${count})…`);
    const chunkBuffer = await sliceChunk(srcBuffer, start, end);
    const { pages, inputTokens, outputTokens } = await ocrChunk(
      chunkBuffer,
      start,
      count,
    );
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    allPages.push(...pages);
    console.log(
      `    → ${pages.length} pages transcribed (in:${inputTokens} out:${outputTokens} tok)`,
    );
  }

  if (allPages.length === 0) {
    throw new Error('OCR produced zero pages — leaving manual untouched.');
  }

  // Dedup by page number (last write wins) and sort.
  const byPage = new Map<number, string>();
  for (const p of allPages) byPage.set(p.page, p.text);
  const finalPages = Array.from(byPage.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, extractedText]) => ({ pageNumber, extractedText }));

  // Delete + recreate page rows (mirrors retryExtraction), then flag
  // ocr=true + ACTIVE. Sequential ops — keep it simple + idempotent.
  await prisma.reloadingManualPage.deleteMany({ where: { manualId } });
  await prisma.reloadingManualPage.createMany({
    data: finalPages.map((p) => ({
      manualId,
      pageNumber: p.pageNumber,
      extractedText: p.extractedText,
    })),
  });
  await prisma.reloadingManual.update({
    where: { id: manualId },
    data: {
      status: ReloadingManualStatus.ACTIVE,
      ocr: true,
      pageCount: finalPages.length,
      errorMessage: null,
    },
  });

  const costUsd =
    (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  console.log(
    `  ✓ "${label}" done — ${finalPages.length} pages, ocr=true, ACTIVE. ` +
      `Cost ≈ $${costUsd.toFixed(4)} (in:${totalInputTokens} out:${totalOutputTokens} tok @ ${MODEL}).`,
  );
}

/** Resolve the list of manual ids to process. */
async function resolveTargets(argv: string[]): Promise<string[]> {
  if (argv.length > 0) return argv;

  // Default: ACTIVE (or FAILED) manuals that have pages but ZERO pages
  // with non-empty extractedText — i.e. pdf-parse gave us nothing usable.
  // Use a raw query so we can count non-empty text per manual cheaply.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT m."id"
    FROM "ReloadingManual" m
    WHERE m."status" IN ('ACTIVE', 'FAILED')
      AND EXISTS (
        SELECT 1 FROM "ReloadingManualPage" p WHERE p."manualId" = m."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "ReloadingManualPage" p
        WHERE p."manualId" = m."id"
          AND length(trim(coalesce(p."extractedText", ''))) > 0
      );
  `);
  return rows.map((r) => r.id);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter(Boolean);
  console.log(
    `OCR backfill starting — model=${MODEL}, chunk=${CHUNK_PAGES} pages, storage=${STORAGE_DIR}`,
  );
  console.log(
    'COST NOTE: each chunk is a Claude vision call billed at input+output tokens. ' +
      'A 200-page manual ≈ 14 calls. Run on a few ids first to gauge spend.',
  );

  const targets = await resolveTargets(argv);
  if (targets.length === 0) {
    console.log(
      'No manuals to OCR (no ids given and none with pages-but-no-text found).',
    );
    return;
  }
  console.log(`Targets (${targets.length}): ${targets.join(', ')}`);

  let ok = 0;
  let failed = 0;
  for (const id of targets) {
    try {
      await backfillManual(id);
      ok++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ manual ${id} failed: ${message}`);
      // Best-effort: mark FAILED so the admin UI shows it needs attention.
      await prisma.reloadingManual
        .update({
          where: { id },
          data: {
            status: ReloadingManualStatus.FAILED,
            errorMessage: `OCR backfill failed: ${message}`.slice(0, 1000),
          },
        })
        .catch(() => undefined);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed (of ${targets.length}).`);
}

main()
  .catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
