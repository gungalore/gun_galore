/**
 * Build / refresh the legal corpus.
 *
 * Source files: backend/data/legal/*.txt (LawLibrary exports supplied by the
 * operator). This script parses them into section rows and upserts one
 * `LegalSource` per document plus its `LegalProvision` rows.
 *
 * Run:
 *   npm run legal:ingest             # apply
 *   npm run legal:ingest -- --dry-run
 *
 * Idempotent: a source is matched by slug, its provisions are replaced only
 * when the content hash changes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  legalSourceSpecs,
  parseLegalSource,
} from '../src/legal/legal-parser';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

async function main() {
  for (const spec of legalSourceSpecs()) {
    const path = resolve(ROOT, spec.sourcePath);
    const raw = readFileSync(path, 'utf8');
    const contentHash = createHash('sha256').update(raw).digest('hex');
    const parsed = parseLegalSource(raw, spec);
    console.log(
      `${spec.slug}: ${parsed.provisions.length} provisions ` +
        `(${contentHash.slice(0, 12)}${DRY_RUN ? ', dry run' : ''})`,
    );
    if (DRY_RUN) continue;

    const existing = await prisma.legalSource.findUnique({
      where: { slug: spec.slug },
      select: {
        id: true,
        contentHash: true,
        _count: { select: { provisions: true } },
      },
    });
    if (
      existing &&
      !FORCE &&
      existing.contentHash === contentHash &&
      existing._count.provisions > 0
    ) {
      console.log(`  ${spec.slug}: unchanged`);
      continue;
    }

    const source = await prisma.legalSource.upsert({
      where: { slug: spec.slug },
      create: {
        slug: spec.slug,
        title: spec.title,
        shortTitle: spec.shortTitle,
        citation: spec.citation,
        documentType: spec.documentType,
        version: spec.version,
        effectiveDate: spec.effectiveDate ? new Date(spec.effectiveDate) : null,
        licence: spec.licence,
        sourceUrl: spec.sourceUrl,
        sourcePath: spec.sourcePath,
        fullText: raw,
        contentHash,
      },
      update: {
        title: spec.title,
        shortTitle: spec.shortTitle,
        citation: spec.citation,
        documentType: spec.documentType,
        version: spec.version,
        effectiveDate: spec.effectiveDate ? new Date(spec.effectiveDate) : null,
        licence: spec.licence,
        sourceUrl: spec.sourceUrl,
        sourcePath: spec.sourcePath,
        fullText: raw,
        contentHash,
      },
      select: { id: true, contentHash: true },
    });


    await prisma.$transaction(async (tx) => {
      await tx.legalProvision.deleteMany({ where: { sourceId: source.id } });
      // Chunked: a createMany with every provision in one statement can exceed
      // the parameter ceiling on a long regulation.
      for (let i = 0; i < parsed.provisions.length; i += 200) {
        await tx.legalProvision.createMany({
          data: parsed.provisions.slice(i, i + 200).map((p) => ({
            sourceId: source.id,
            documentType: p.documentType,
            chapter: p.chapter,
            part: p.part,
            sectionNumber: p.sectionNumber,
            heading: p.heading,
            citation: p.citation,
            ordinal: p.ordinal,
            text: p.text,
          })),
        });
      }
    });
    console.log(`  ${spec.slug}: ${parsed.provisions.length} rows written`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
