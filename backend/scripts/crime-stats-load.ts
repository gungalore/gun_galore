/**
 * LOAD THE SAPS CRIME STATISTICS NOW, WITHOUT WAITING FOR SUNDAY.
 *
 * The weekly cron (`CrimeStatsFetchService.weekly`, Sunday 03:40) is how this
 * stays current. This script is how it gets its FIRST release: run once on the
 * box after a deploy, so the station picker and the precinct figures have
 * something to answer with instead of an empty table.
 *
 * It is also the retry button of last resort — a release left 'failed' is
 * picked up again on every run, because the skip list is keyed on 'ready'.
 *
 * Run:
 *   cd /home/alloutdoor/app/backend
 *   npx ts-node --transpile-only --project tsconfig.json scripts/crime-stats-load.ts
 *
 *   ...or `npm run crime-stats:load`. Pass a number to change how many
 *   releases one run will load (default 4, one SAPS year):
 *   `npm run crime-stats:load -- 1`
 *
 * ⚠️ IT WRITES TO THE DATABASE THE .env POINTS AT. It only ever INSERTS into
 * the three CrimeStats* tables and never touches anything else, but run it on
 * the box, against the box's .env, not from a laptop with a production
 * DATABASE_URL.
 *
 * ⚠️ IT IS SLOW ON PURPOSE. A release is ~258 000 figures inserted in 5 000-row
 * batches, each in its own short transaction, precisely so it does not hold a
 * long lock on a live database. Expect minutes, not seconds.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { CrimeStatsFetchService } from '../src/crime-stats/crime-stats-fetch.service';

async function main(): Promise<void> {
  const raw = process.argv[2];
  const max = raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined;

  console.log('[crime-stats] booting the application context …');
  const app: INestApplicationContext =
    await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });

  // Stop every scheduled job before doing anything. Booting the whole
  // AppModule arms every @Cron in the codebase, and a one-off loader must not
  // also fire the auction-end sweep or an SMS run as a side effect.
  try {
    const scheduler = app.get(SchedulerRegistry, { strict: false });
    scheduler.getCronJobs().forEach((job) => {
      try {
        job.stop();
      } catch {
        /* a job that will not stop is not a reason to abandon the load */
      }
    });
  } catch {
    console.warn('[crime-stats] no scheduler registry; continuing');
  }

  try {
    const fetcher = app.get(CrimeStatsFetchService, { strict: false });
    const started = Date.now();
    const out = await fetcher.runNow(max === undefined ? {} : { max });
    const secs = Math.round((Date.now() - started) / 1000);

    console.log('');
    console.log('──────────── SAPS crime statistics ────────────');
    console.log(`workbooks linked on the page : ${out.found}`);
    console.log(`already held as ready        : ${out.alreadyHeld}`);
    console.log(`loaded this run              : ${out.loaded.join(', ') || '-'}`);
    console.log(`failed this run              : ${out.failed.join(', ') || '-'}`);
    console.log(`deferred to a later run      : ${out.deferred.join(', ') || '-'}`);
    console.log(`took                         : ${secs}s`);
    for (const m of out.messages) console.log(`  ${m}`);
    console.log('───────────────────────────────────────────────');

    // A failure is worth a non-zero exit so a deploy script notices it, but
    // NOT when something loaded — a run that got three of four releases in is
    // a success with a note, and failing the deploy over it helps nobody.
    if (out.failed.length > 0 && out.loaded.length === 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[crime-stats] load failed:', err);
  process.exit(1);
});
