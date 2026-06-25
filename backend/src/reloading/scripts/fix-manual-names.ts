/**
 * MANUAL NAME FIX — standalone, NOT wired into app boot.
 *
 * Cleans up the filename-derived manufacturer/title/edition for the 9
 * known manuals in the library. Matches each row by its CURRENT
 * manufacturer string (exact equality) and overwrites manufacturer +
 * title + edition with the canonical values below.
 *
 *   Usage:
 *     npx ts-node src/reloading/scripts/fix-manual-names.ts
 *
 *   Env:
 *     DATABASE_URL — Postgres connection (required)
 *
 * Idempotent: matching on the OLD manufacturer means a second run finds
 * nothing to change (the manufacturer has already been rewritten). Safe
 * to run twice. DOES NOT touch prod unless DATABASE_URL points there.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

interface NameFix {
  /** Current manufacturer value to match on (exact equality). */
  current: string;
  manufacturer: string;
  title: string;
  edition: string | null;
}

// current manufacturer → new { manufacturer, title, edition }
const FIXES: NameFix[] = [
  { current: 'Hornday', manufacturer: 'Hornady', title: 'Reloading Handbook', edition: '10th Edition' },
  { current: 'Vihtoviori', manufacturer: 'Vihtavuori', title: 'Reloading Guide', edition: null },
  { current: 'Hodgdonreloadingmanual', manufacturer: 'Hodgdon', title: 'Reloading Data Manual', edition: null },
  { current: 'Imrbook', manufacturer: 'IMR', title: "Handloader's Guide", edition: null },
  { current: 'Lyman', manufacturer: 'Lyman', title: 'Reloading Handbook', edition: '49th Edition (2008)' },
  { current: 'Somchem', manufacturer: 'Somchem', title: 'Reloading Data', edition: 'Nov 2023' },
  { current: 'Alliant', manufacturer: 'Alliant', title: "Reloader's Guide", edition: null },
  { current: 'Handbook', manufacturer: 'Various', title: 'Handbook of Reloading Basics', edition: null },
  { current: 'The', manufacturer: 'Various', title: 'The ABCs of Reloading', edition: null },
];

async function main(): Promise<void> {
  console.log(`Manual name fix starting — ${FIXES.length} mappings.`);

  let updated = 0;
  let notFound = 0;

  for (const fix of FIXES) {
    // Match on the CURRENT manufacturer string (exact equality). There
    // can in principle be more than one row sharing a current value
    // (e.g. two "Various"-ish uploads), so use updateMany.
    const result = await prisma.reloadingManual.updateMany({
      where: { manufacturer: fix.current },
      data: {
        manufacturer: fix.manufacturer,
        title: fix.title,
        edition: fix.edition,
      },
    });

    if (result.count > 0) {
      updated += result.count;
      console.log(
        `  ✓ "${fix.current}" → ${fix.manufacturer} | "${fix.title}"` +
          `${fix.edition ? ` | ${fix.edition}` : ''}  (${result.count} row${
            result.count === 1 ? '' : 's'
          })`,
      );
    } else {
      notFound++;
      console.log(
        `  – "${fix.current}" — no matching row (already fixed, or not present).`,
      );
    }
  }

  console.log(
    `\nDone. ${updated} row(s) updated, ${notFound} mapping(s) had no match.`,
  );
}

main()
  .catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
