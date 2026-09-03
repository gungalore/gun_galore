/**
 * LOAD EXTRACTION — standalone, NOT wired into app boot.
 *
 * Reads the ACTIVE reloading manuals already in the library and extracts
 * published load data for the cartridges you name, upserting ManualLoad rows.
 * Those rows are what Load Lab serves: burn-chart, manual-browse and
 * recommended-loads all read them, so this script is the only route by which
 * /load-lab gains new data.
 *
 * ⚠️ THIS REPLACES THE ADMIN BUTTON, DELIBERATELY. Reloading is gone from the
 * admin panel by operator decision — the library is content, not operations,
 * and Load Lab is changed in code from here on. Ingest already had a script
 * (library-ingest.ts); extraction did not, and removing the panel without
 * this would have quietly ended Load Lab's ability to grow.
 *
 * ⚠️ IT COSTS MONEY AND IT IS NOT INSTANT. Extraction runs Claude once per
 * candidate page, per cartridge. Naming ten cartridges is ten passes over the
 * library. That is a second reason it belongs at a prompt rather than behind
 * a button somebody can lean on.
 *
 * ⚠️ ONLY PUBLISHED MANUFACTURER DATA BELONGS IN THE LIBRARY. Extraction is
 * only as trustworthy as what was ingested; homemade-load documents must
 * never reach the inbox in the first place.
 *
 *   Usage:
 *     npx ts-node --transpile-only -r tsconfig-paths/register \
 *       src/reloading/scripts/extract-loads.ts ".308 Winchester" "9mm Luger"
 *
 *   Re-running is safe: extraction upserts, so no duplicates.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { LoadDataExtractionService } from '../load-data-extraction.service';

async function main(): Promise<void> {
  const cartridges = process.argv.slice(2).filter((a) => a.trim().length > 0);

  if (cartridges.length === 0) {
    console.error(
      'Name at least one cartridge, exactly as the manuals write it.\n' +
        '  e.g. npx ts-node --transpile-only src/reloading/scripts/extract-loads.ts ".308 Winchester"\n',
    );
    process.exit(1);
  }

  console.log(
    `Load extraction — ${cartridges.length} cartridge(s). ` +
      'Runs Claude per candidate page; this is not free and not fast.\n',
  );

  // A full application context rather than a bare PrismaClient: the
  // extraction service depends on ReloadingService for page fetching, and
  // hand-wiring that here would be a second copy of the dependency graph to
  // keep in step.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const extraction = app.get(LoadDataExtractionService, { strict: false });
    let total = 0;

    for (const cartridge of cartridges) {
      process.stdout.write(`  ${cartridge} … `);
      try {
        const summary = await extraction.extractForCartridge(cartridge);
        const n =
          (summary as { inserted?: number; loads?: number; count?: number }).inserted ??
          (summary as { loads?: number }).loads ??
          (summary as { count?: number }).count ??
          0;
        total += n;
        console.log(`${n} load(s)`);
      } catch (err) {
        // One bad cartridge never stops the rest — same rule the payout run
        // follows. The failure is printed and the loop continues.
        console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`\nDone. ${total} load(s) upserted across ${cartridges.length} cartridge(s).`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
