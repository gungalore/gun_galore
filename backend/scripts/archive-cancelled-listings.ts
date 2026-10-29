/**
 * Safe cleanup for old CANCELLED listings that never became a sale.
 *
 * Dry-run by default. It deletes the Cloudinary photos/video and hides the
 * listing from /my/listings, but keeps the Listing row and every
 * offer/bid/notification/audit reference. Listings with a Transaction or
 * OrderLineItem are never touched.
 *
 * Usage:
 *   npm run listings:archive-cancelled
 *   npm run listings:archive-cancelled -- --days=30 --limit=100 --apply
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ListingsService } from '../src/listings/listings.service';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

(async () => {
  const olderThanDays = Number(arg('days') ?? 90);
  const limit = Number(arg('limit') ?? 50);
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const listings = app.get(ListingsService, { strict: false });
    const result = await listings.archiveStaleCancelledListings({
      olderThanDays: Number.isFinite(olderThanDays) ? olderThanDays : 90,
      limit: Number.isFinite(limit) ? limit : 50,
      dryRun: !apply,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
