/**
 * Ensure the FeaturedSlot rows exist.
 *
 * WHY THIS EXISTS
 *
 * schema.prisma describes FeaturedSlot.slotNumber as "1-10. Hard-allocated at
 * seed." — but nothing ever seeded them. The only featuredSlot.create in the
 * repo lived in the offline dummy-run harness, so a real database came up with
 * ZERO slots. Found on production 2026-08-15: /featured/summary returned
 * totalSlots 0, the homepage Featured section had nothing to render, and no
 * seller could bid for a spot because no spot existed to bid on.
 *
 * prisma/seed.ts now creates them too, which covers any fresh install. This
 * script is the surgical version for a database that already exists, where
 * running the full seed would also touch categories, attributes and the admin
 * user — far more than you want against live data.
 *
 * SAFE TO RE-RUN. Every write is an upsert with `update: {}`, so an existing
 * slot's status, occupant, auction and expiry are left completely untouched.
 * It only ever adds slots that are missing.
 *
 * WHAT HAPPENS AFTER: new rows land VACANT with no auction. The featured-tick
 * cron (every minute) then opens an AD_HOC auction on each one at
 * closesAt = null — the countdown starts only when a seller places the first
 * bid. That is the documented cold-start path, so this starts no timer and
 * charges nobody.
 *
 *   npx ts-node -T scripts/ensure-featured-slots.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.featuredSlot.count();

  // Count comes from config so the two can't disagree.
  const cfg = await prisma.featuredSlotConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  for (let n = 1; n <= cfg.slotCount; n++) {
    await prisma.featuredSlot.upsert({
      where: { slotNumber: n },
      update: {},
      create: { slotNumber: n, status: 'VACANT' },
    });
  }

  const after = await prisma.featuredSlot.count();
  const rows = await prisma.featuredSlot.findMany({
    orderBy: { slotNumber: 'asc' },
    select: { slotNumber: true, status: true, currentListingId: true },
  });

  console.log(`slotCount config : ${cfg.slotCount}`);
  console.log(`slots before     : ${before}`);
  console.log(`slots after      : ${after}  (added ${after - before})`);
  for (const r of rows) {
    console.log(
      `  slot ${String(r.slotNumber).padStart(2)}  ${r.status}` +
        (r.currentListingId ? `  listing=${r.currentListingId}` : ''),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
