/**
 * LIBRARY INGEST — standalone, NOT wired into app boot.
 *
 * Ingests every PDF in the reloading INBOX dir into the manual library:
 * SHA-256 dedup → copy into the STORAGE dir (random-prefix + hash suffix,
 * mirrors ReloadingService.ingestPdfFromPath) → create a ReloadingManual
 * row with clean metadata → pdf-parse text extraction → ReloadingManualPage
 * rows → status ACTIVE. The Postgres GENERATED tsvector auto-populates, so
 * Ask GG search works immediately; the stored file powers fetchManualPages.
 *
 * Runs over SSH without an admin JWT (unlike the admin "scan inbox" route).
 *
 *   Usage:
 *     node dist/src/reloading/scripts/library-ingest.js
 *     node --max-old-space-size=4096 dist/.../library-ingest.js   # big PDFs
 *
 *   Env (mirrors reloading.service.ts):
 *     DATABASE_URL                  — Postgres (required)
 *     RELOADING_MANUALS_INBOX_DIR   — source dir (default ../manual-inbox)
 *     RELOADING_MANUALS_STORAGE_DIR — permanent dir (default ../manuals)
 *
 * Idempotent: a file whose content hash already exists is SKIPPED (so it's
 * safe to re-run). Each file is independent — one failure doesn't abort the
 * rest (its row is marked FAILED + the orphan file unlinked).
 */
import 'dotenv/config';
import { PrismaClient, ReloadingManualStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PDFParse } from 'pdf-parse';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const INBOX_DIR =
  process.env.RELOADING_MANUALS_INBOX_DIR ??
  path.resolve(process.cwd(), '..', 'manual-inbox');
const STORAGE_DIR =
  process.env.RELOADING_MANUALS_STORAGE_DIR ??
  path.resolve(process.cwd(), '..', 'manuals');

// AdminUser id to stamp as uploader. Resolved at runtime (first admin).
let UPLOADER_ID = '';

// Clean metadata per curated inbox filename. Anything not listed falls back
// to a title-cased filename + manufacturer "Various".
const META: Record<
  string,
  { manufacturer: string; title: string; edition: string | null }
> = {
  'Hornady Reloading Handbook 10th.pdf': { manufacturer: 'Hornady', title: 'Reloading Handbook', edition: '10th Edition' },
  'Nosler Reloading Guide 7.pdf': { manufacturer: 'Nosler', title: 'Reloading Guide 7', edition: '2012' },
  'Lyman Reloading Handbook 49th.pdf': { manufacturer: 'Lyman', title: 'Reloading Handbook', edition: '49th Edition (2008)' },
  'Hodgdon Reloading Manual.pdf': { manufacturer: 'Hodgdon', title: 'Reloading Manual', edition: '2002' },
  'Vihtavuori Reloading Guide 2026.pdf': { manufacturer: 'Vihtavuori', title: 'Reloading Guide', edition: '2026' },
  'IMR Handloaders Guide.pdf': { manufacturer: 'IMR', title: "Handloader's Guide", edition: null },
  'Alliant Reloaders Guide.pdf': { manufacturer: 'Alliant', title: "Reloader's Guide", edition: null },
  'Accurate Smokeless Powder Guide.pdf': { manufacturer: 'Accurate', title: 'Smokeless Powder Guide', edition: null },
  'Ramshot Handloading Guide.pdf': { manufacturer: 'Ramshot', title: 'Handloading Guide', edition: 'Edition II' },
  'ADI Reloaders Guide.pdf': { manufacturer: 'ADI', title: "Reloader's Guide", edition: '2000' },
  'Somchem Reloading Data.pdf': { manufacturer: 'Somchem', title: 'Reloading Data', edition: 'Nov 2023' },
  'Hodgdon Pyrodex Data.pdf': { manufacturer: 'Hodgdon', title: 'Pyrodex Data', edition: '2000' },
  'Handbook of Reloading Basics.pdf': { manufacturer: 'Various', title: 'Handbook of Reloading Basics', edition: null },
  'The ABCs of Reloading.pdf': { manufacturer: 'Various', title: 'The ABCs of Reloading', edition: null },
  'Winchester Components Catalog.pdf': { manufacturer: 'Winchester', title: 'Components Catalog', edition: null },
  'Remington Shotshell Guide.pdf': { manufacturer: 'Remington', title: 'Shotgun & Shotshell Guide', edition: null },
  'Pistol and Rifle Ballistics Table.pdf': { manufacturer: 'Various', title: 'Pistol & Rifle Ballistics Tables', edition: null },
  'Centerfire Rifle Ballistics Table.pdf': { manufacturer: 'Various', title: 'Centerfire Rifle Ballistics Table', edition: null },
  'Centerfire Pistol Ballistics Table.pdf': { manufacturer: 'Various', title: 'Centerfire Pistol & Revolver Ballistics Table', edition: null },
};

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

function titleCase(s: string): string {
  return s.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

async function extractPages(buffer: Buffer): Promise<Array<{ num: number; text: string }>> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ num: p.num, text: p.text ?? '' }));
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function ingestOne(filename: string): Promise<'INGESTED' | 'SKIPPED' | 'FAILED'> {
  const fullPath = path.join(INBOX_DIR, filename);
  const buffer = await fs.readFile(fullPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const suffix = `${sha256.slice(0, 16)}.pdf`;

  const existing = await prisma.reloadingManual.findFirst({
    where: { storedPath: { endsWith: suffix } },
    select: { id: true },
  });
  if (existing) {
    console.log(`  [skip] ${filename} — already ingested (${existing.id})`);
    return 'SKIPPED';
  }

  const storedFilename = `${randomBytes(8).toString('hex')}-${suffix}`;
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(STORAGE_DIR, storedFilename), buffer);

  const meta = META[filename] ?? {
    manufacturer: 'Various',
    title: titleCase(filename),
    edition: null,
  };

  let manualId = '';
  try {
    const manual = await prisma.reloadingManual.create({
      data: {
        manufacturer: meta.manufacturer,
        title: meta.title,
        edition: meta.edition,
        storedPath: storedFilename,
        fileSizeBytes: buffer.length,
        status: ReloadingManualStatus.PROCESSING,
        uploadedByAdminId: UPLOADER_ID,
      },
      select: { id: true },
    });
    manualId = manual.id;

    const pages = await extractPages(buffer);
    const nonEmpty = pages.filter((p) => (p.text ?? '').trim().length > 0).length;
    if (pages.length === 0) throw new Error('pdf-parse returned zero pages');

    await prisma.reloadingManualPage.createMany({
      data: pages.map((p) => ({ manualId, pageNumber: p.num, extractedText: p.text ?? '' })),
    });
    await prisma.reloadingManual.update({
      where: { id: manualId },
      data: { status: ReloadingManualStatus.ACTIVE, pageCount: pages.length },
    });
    console.log(
      `  [ok]   ${meta.manufacturer} — ${meta.title} (${pages.length}pp, ${nonEmpty} w/ text)` +
        (nonEmpty === 0 ? '  ⚠ NO TEXT (scanned — needs OCR)' : ''),
    );
    return 'INGESTED';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [FAIL] ${filename}: ${msg}`);
    if (manualId) {
      await prisma.reloadingManual
        .update({
          where: { id: manualId },
          data: { status: ReloadingManualStatus.FAILED, errorMessage: msg.slice(0, 1000) },
        })
        .catch(() => undefined);
    } else {
      await fs.unlink(path.join(STORAGE_DIR, storedFilename)).catch(() => undefined);
    }
    return 'FAILED';
  }
}

async function main(): Promise<void> {
  const admin = await prisma.adminUser.findFirst({ select: { id: true } });
  if (!admin) throw new Error('No AdminUser found to stamp as uploader.');
  UPLOADER_ID = admin.id;

  console.log(`Library ingest — inbox=${INBOX_DIR} storage=${STORAGE_DIR}`);
  let files: string[];
  try {
    files = (await fs.readdir(INBOX_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  } catch {
    console.log('Inbox dir not readable / empty.');
    return;
  }
  if (files.length === 0) {
    console.log('No PDFs in inbox.');
    return;
  }
  console.log(`Found ${files.length} PDF(s).`);
  let ing = 0, skip = 0, fail = 0;
  for (const f of files) {
    try {
      const r = await ingestOne(f);
      if (r === 'INGESTED') ing++;
      else if (r === 'SKIPPED') skip++;
      else fail++;
    } catch (err) {
      fail++;
      console.error(`  [FAIL] ${f}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone. ${ing} ingested, ${skip} skipped, ${fail} failed (of ${files.length}).`);
}

main()
  .catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
