// Seed one ACTIVE featured ad so the feed has something to show locally.
// Idempotent-ish: it does nothing if any FeedAd already exists.
//
//   cd backend && npm run seed:feed-ads

import { FeedAdStatus, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL as string),
});

async function main() {
  const existing = await prisma.feedAd.count();
  if (existing > 0) {
    console.log(`FeedAd already has ${existing} row(s); skipping.`);
    return;
  }
  await prisma.feedAd.create({
    data: {
      title: 'New and secondhand outdoor gear',
      body: 'Browse the latest listings across camping, fishing, overlanding and more.',
      ctaUrl: '/',
      ctaLabel: 'Shop now',
      advertiser: 'All Outdoor',
      status: FeedAdStatus.ACTIVE,
      sortOrder: 0,
    },
  });
  console.log('Seeded 1 featured ad (ACTIVE).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
