/**
 * Gun Galore end-to-end "dummy run" — boots the REAL backend against the
 * isolated throwaway DB (gun_galore_dummyrun) with every external integration
 * neutralised, then drives each money/fulfilment module through its full
 * lifecycle via the real service methods, asserting state + money conservation.
 *
 * Prereq (once):  npm run dummy-run:setup
 * Run:            npm run dummy-run
 *
 * Safety: refuses to run unless DATABASE_URL is localhost/gun_galore_dummyrun and
 * every sensitive key is blank. It NEVER touches prod or the dev DB, and every
 * external client (payments, courier, KYC, email/SMS, Zoho, Cloudinary, AI) is a
 * no-op/stub. See scripts/dummy-run-setup.ts + backend/.env.dummyrun.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Reporter } from './dummy-run/harness';
import {
  Ctx,
  cleanup,
  installStubs,
  seedActors,
  seedHouseSeller,
  resolveCategories,
} from './dummy-run/seed';
import { runModule } from './dummy-run/money';
import {
  moduleBuyNow,
  moduleFirearm,
  moduleAuctions,
  moduleOffers,
  moduleOrders,
  moduleContentSmoke,
  moduleDailyDeals,
  moduleFinalLedger,
} from './dummy-run/modules';

const REQUIRED_DB = 'gun_galore_dummyrun';
// A representative set of keys that MUST be blank for the run to be safe.
const MUST_BE_BLANK = [
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'SMSPORTAL_API_SECRET',
  'PUDO_API_KEY',
  'TCG_API_KEY',
  'STITCH_CLIENT_SECRET',
  'CLOUDINARY_API_SECRET',
  'MEILISEARCH_HOST',
];

function assertSafeEnv() {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  let db = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    db = u.pathname.replace(/^\//, '').split('?')[0];
  } catch {
    /* fallthrough to the failure below */
  }
  const localhost = host === 'localhost' || host === '127.0.0.1';
  if (!localhost || db !== REQUIRED_DB) {
    throw new Error(
      `SAFETY ABORT: DATABASE_URL must be localhost/${REQUIRED_DB}. Got host='${host}', db='${db}'. ` +
        `Did you preload backend/.env.dummyrun? (run: npm run dummy-run)`,
    );
  }
  const leaked = MUST_BE_BLANK.filter((k) => (process.env[k] ?? '') !== '');
  if (leaked.length) {
    throw new Error(
      `SAFETY ABORT: these keys are NOT blank — a real integration could fire: ${leaked.join(', ')}. ` +
        `They must be empty in .env.dummyrun.`,
    );
  }
  if ((process.env.PAYMENT_MODE ?? '') !== 'manual') {
    throw new Error(`SAFETY ABORT: PAYMENT_MODE must be 'manual', got '${process.env.PAYMENT_MODE}'.`);
  }
}

function printSafeBanner() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  GUN GALORE — DUMMY RUN  (SAFE MODE)');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  DB          : ${REQUIRED_DB} @ localhost  (isolated, throwaway)`);
  console.log('  Payments    : manual EFT only, no gateway call');
  console.log('  Courier     : Pudo/TCG keys blank → no waybill, no credits billed');
  console.log('  KYC         : sandbox; test users seeded VERIFIED directly');
  console.log('  Zoho/Email  : disabled (ZOHO_BOOKS_ENABLED=false, RESEND blank)');
  console.log('  SMS/Push    : blank → STUB log rows only');
  console.log('  Anthropic   : blank → every AI flow degrades gracefully (no cost)');
  console.log('  Cloudinary  : blank → no uploads');
  console.log('  Nothing real is touched. No money moves.');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');
}

async function main() {
  assertSafeEnv();
  printSafeBanner();

  console.log('[boot] creating Nest application context (full AppModule) …');
  let app: INestApplicationContext;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      // Keep it quiet — we only want our own progress + real errors.
      logger: ['error', 'warn'],
      abortOnError: false,
    });
  } catch (e) {
    console.error('[boot] FAILED to create application context:', e);
    process.exit(1);
  }

  // Stop every scheduled cron so nothing fires mid-run; we invoke sweeps by hand.
  try {
    const scheduler = app.get(SchedulerRegistry, { strict: false });
    const jobs = scheduler.getCronJobs();
    let stopped = 0;
    jobs.forEach((job) => {
      try {
        job.stop();
        stopped++;
      } catch {
        /* some jobs may already be idle */
      }
    });
    console.log(`[boot] stopped ${stopped} cron job(s) — no auto-fire during the run.`);
  } catch (e) {
    console.warn('[boot] could not access SchedulerRegistry (continuing):', (e as Error).message);
  }

  console.log('[boot] application context is up. ✓');

  // Neutralise the two outbound courier-rate calls (blank keys → null quote →
  // dead-ended courier checkout). This stubs ONLY the external rate lookup; the
  // whole transaction + fee code path under test still runs for real.
  const tcgShipments = installStubs(app);

  const prisma = app.get(PrismaService, { strict: false });
  const rep = new Reporter();

  console.log('[seed] wiping prior dummy-run data (idempotent) …');
  await cleanup(prisma);
  console.log('[seed] seeding actors + resolving categories …');
  const actors = await seedActors(prisma);
  // DD-2 — the Daily Deals house seller (+ its Setting) for the house-money module.
  actors.house = await seedHouseSeller(prisma);
  const cats = await resolveCategories(prisma);
  const ctx: Ctx = { app, prisma, rep, actors, cats, tcgShipments };
  console.log(`[seed] ${Object.keys(actors).length} actors ready.`);

  // ── Module drivers ──────────────────────────────────────────────────
  await runModule(ctx, 'Marketplace BUY_NOW', moduleBuyNow);
  await runModule(ctx, 'Firearm DEALER_TRANSFER', moduleFirearm);
  await runModule(ctx, 'Auctions', moduleAuctions);
  await runModule(ctx, 'Take-a-Shot offers', moduleOffers);
  await runModule(ctx, 'Cart / Orders (multi-seller)', moduleOrders);
  await runModule(ctx, 'Daily Deals (house)', moduleDailyDeals);
  await runModule(ctx, 'Content smoke', moduleContentSmoke);
  await runModule(ctx, 'Held-funds closing balance', moduleFinalLedger);

  // ── Report ──────────────────────────────────────────────────────────
  rep.printSummary();
  const reportPath = path.resolve(__dirname, '..', '..', 'DUMMY-RUN-REPORT.md');
  rep.writeMarkdown(reportPath);

  // Let any trailing fire-and-forget side-effects flush before teardown.
  await new Promise((r) => setTimeout(r, 400));
  await app.close();
  console.log('[done] context closed cleanly.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[dummy-run] UNHANDLED:', e);
  process.exit(1);
});
