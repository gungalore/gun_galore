import 'dotenv/config';
import { PrismaClient, type ListingType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// One-shot backfill: assigns UM/AU/TS reference numbers to every
// existing Listing row that lacks one, and RA numbers to every Raffle.
//
// Order: createdAt ASC so the oldest listing gets UM000001 etc.
// Counters land in ReferenceCounter at the highest number we wrote,
// so the next live create() naturally continues the sequence.
//
// Safe to re-run — only touches rows where referenceNumber IS NULL.
//
//   npx tsx prisma/backfill-reference-numbers.ts

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const LISTING_TYPE_TO_PREFIX: Record<ListingType, 'UM' | 'AU' | 'TS'> = {
  BUY_NOW: 'UM',
  AUCTION: 'AU',
  TAKE_A_SHOT: 'TS',
};

function fmt(prefix: string, count: number): string {
  return `${prefix}${String(count).padStart(6, '0')}`;
}

async function main() {
  // ─── Listings ────────────────────────────────────────────────────
  const listings = await prisma.listing.findMany({
    where: { referenceNumber: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, listingType: true },
  });
  console.log(`Backfilling ${listings.length} listings…`);

  const perPrefixCount: Record<string, number> = { UM: 0, AU: 0, TS: 0, RA: 0 };

  // Seed counters from existing referenceNumbers so we don't collide
  // with rows that DO have one (e.g. anything created via the live
  // service path after the schema change).
  const existing = await prisma.listing.findMany({
    where: { referenceNumber: { not: null } },
    select: { referenceNumber: true },
  });
  for (const row of existing) {
    const ref = row.referenceNumber!;
    const prefix = ref.slice(0, 2);
    const n = Number(ref.slice(2));
    if (Number.isFinite(n) && perPrefixCount[prefix] < n) {
      perPrefixCount[prefix] = n;
    }
  }
  const existingRaffles = await prisma.raffle.findMany({
    where: { referenceNumber: { not: null } },
    select: { referenceNumber: true },
  });
  for (const row of existingRaffles) {
    const ref = row.referenceNumber!;
    const n = Number(ref.slice(2));
    if (Number.isFinite(n) && perPrefixCount.RA < n) {
      perPrefixCount.RA = n;
    }
  }

  for (const l of listings) {
    const prefix = LISTING_TYPE_TO_PREFIX[l.listingType];
    perPrefixCount[prefix]++;
    const ref = fmt(prefix, perPrefixCount[prefix]);
    await prisma.listing.update({
      where: { id: l.id },
      data: { referenceNumber: ref },
    });
    console.log(`  ${ref}  ←  ${l.id}`);
  }

  // ─── Raffles ─────────────────────────────────────────────────────
  const raffles = await prisma.raffle.findMany({
    where: { referenceNumber: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  console.log(`Backfilling ${raffles.length} raffles…`);
  for (const r of raffles) {
    perPrefixCount.RA++;
    const ref = fmt('RA', perPrefixCount.RA);
    await prisma.raffle.update({
      where: { id: r.id },
      data: { referenceNumber: ref },
    });
    console.log(`  ${ref}  ←  ${r.id}`);
  }

  // ─── Sync counters ──────────────────────────────────────────────
  for (const prefix of ['UM', 'AU', 'TS', 'RA'] as const) {
    await prisma.referenceCounter.upsert({
      where: { prefix },
      create: { prefix, count: perPrefixCount[prefix] },
      update: { count: perPrefixCount[prefix] },
    });
    console.log(`  counter ${prefix} = ${perPrefixCount[prefix]}`);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
