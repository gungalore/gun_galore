/**
 * POLL THE NEWSPAPERS NOW, WITHOUT WAITING FOR 02:50.
 *
 * The nightly cron (`NewsPollService.nightly`) is how the clipping table stays
 * current. This script is how it gets its FIRST articles: run once on the box
 * after a deploy, so a motivation asking "what happened near Brooklyn" has
 * something to answer with instead of an empty table.
 *
 * Run:
 *   cd /home/alloutdoor/app/backend
 *   npm run news:poll
 *
 *   Pass a number to cap how many sources one run touches — the smoke test:
 *   `npm run news:poll -- 10`
 *
 * ⚠️ IT WRITES TO THE DATABASE THE .env POINTS AT, and it fetches ~74 third-
 * party feeds plus an article page per new item. Run it on the box, against
 * the box's .env, not from a laptop with a production DATABASE_URL.
 *
 * ⚠️ WITHOUT GOOGLE_MAPS_API_KEY every coordinate stays null and matching
 * falls back to district and town names. That is a working state, not a
 * broken one — but a box that means to serve this feature wants the key.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { NewsPollService } from '../src/news/news-poll.service';

async function main(): Promise<void> {
  const raw = process.argv[2];
  const maxSources = raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined;

  console.log('[news] booting the application context …');
  const app: INestApplicationContext = await NestFactory.createApplicationContext(
    AppModule,
    { logger: ['error', 'warn', 'log'], abortOnError: false },
  );

  // Stop every scheduled job before doing anything. Booting the whole
  // AppModule arms every @Cron in the codebase, and a one-off loader must not
  // also fire the auction-end sweep or an SMS run as a side effect.
  try {
    const scheduler = app.get(SchedulerRegistry, { strict: false });
    scheduler.getCronJobs().forEach((job) => {
      try {
        job.stop();
      } catch {
        /* a job that will not stop is not a reason to abandon the poll */
      }
    });
  } catch {
    console.warn('[news] no scheduler registry; continuing');
  }

  try {
    const poll = app.get(NewsPollService, { strict: false });
    const started = Date.now();
    const out = await poll.runNow(maxSources === undefined ? {} : { maxSources });
    const secs = Math.round((Date.now() - started) / 1000);

    console.log('');
    console.log('──────────── press clippings ────────────');
    for (const line of out.messages) console.log(`  ${line}`);
    console.log('');
    console.log(`  sources tried   ${out.sourcesTried}`);
    console.log(`  sources ok      ${out.sourcesOk}`);
    console.log(`  sources failed  ${out.sourcesFailed}`);
    console.log(`  items seen      ${out.itemsSeen}`);
    console.log(`  items stored    ${out.itemsNew}`);
    console.log(`  share previews  ${out.previewsFound}`);
    console.log(`  items tagged    ${out.itemsTagged}`);
    console.log(`  tagged as crime ${out.crimeItems}`);
    console.log(`  expired deleted ${out.deleted}`);
    console.log(`  took            ${secs}s`);
    console.log('─────────────────────────────────────────');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[news] poll failed:', err);
  process.exitCode = 1;
});
