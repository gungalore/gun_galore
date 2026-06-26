/**
 * One-off runner to populate the ManualLoad table (Recommended Loads panel).
 * Wires the extraction service manually — does NOT boot AppModule, so no crons
 * or schedulers fire. Reads each cartridge's load-table pages from the DB and
 * has Claude transcribe them into structured rows.
 *
 * Run on prod (where the DB + ANTHROPIC_API_KEY live):
 *   cd /home/gungalore/app/backend
 *   npx ts-node --project tsconfig.json scripts/extract-loads.ts "6.5 Creedmoor"
 *   npx ts-node --project tsconfig.json scripts/extract-loads.ts        # default list
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ReloadingService } from '../src/reloading/reloading.service';
import { LoadDataExtractionService } from '../src/reloading/load-data-extraction.service';

// Common reloading cartridges the manuals cover. Used when no args are passed.
const DEFAULT_CARTRIDGES = [
  '.223 Remington',
  '.22-250 Remington',
  '.243 Winchester',
  '6mm Creedmoor',
  '6.5 Creedmoor',
  '6.5 PRC',
  '6.5x55 Swedish',
  '.270 Winchester',
  '7mm-08 Remington',
  '7mm Remington Magnum',
  '.308 Winchester',
  '.30-06 Springfield',
  '.300 Winchester Magnum',
  '.300 PRC',
  '.303 British',
  '.338 Lapua Magnum',
  '9mm Luger',
  '.357 Magnum',
  '.44 Magnum',
  '.45 ACP',
];

async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const cartridges = args.length > 0 ? args : DEFAULT_CARTRIDGES;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing — cannot extract.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  // Manual DI — no Nest bootstrap, so no scheduled jobs run.
  const reloading = new ReloadingService(prisma as never);
  const extractor = new LoadDataExtractionService(prisma as never, reloading);

  console.log(`Extracting loads for ${cartridges.length} cartridge(s)…\n`);
  let total = 0;
  for (const c of cartridges) {
    try {
      const r = await extractor.extractForCartridge(c);
      total += r.rowsUpserted;
      console.log(
        `  ${c.padEnd(24)} ${String(r.rowsUpserted).padStart(4)} loads · ` +
          `${r.pagesProcessed} pages · ${r.manuals.join(', ') || 'no manuals matched'}`,
      );
    } catch (err) {
      console.log(`  ${c.padEnd(24)} ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone. ${total} loads upserted total.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
