// Create the 10 FeaturedSlot rows that the marketplace assumes exist.
// They should be in the prisma seed but aren't — this script handles
// fresh prod DBs + recovery if rows ever get deleted.
//
// Safe to re-run: uses upsert so existing slots aren't touched.
//
// Usage: node scripts/seed-featured-slots.mjs

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const c = {
  reset: '\x1b[0m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};

console.log(`${c.cyan}Seeding 10 FeaturedSlot rows...${c.reset}\n`);

let created = 0;
let existing = 0;

for (let n = 1; n <= 10; n++) {
  // upsert by slotNumber — unique constraint exists per Prisma schema
  const found = await prisma.featuredSlot.findFirst({ where: { slotNumber: n } });
  if (found) {
    existing += 1;
    console.log(`  Slot #${n}: ${c.yellow}already exists${c.reset} (id ${found.id.slice(0, 8)}...)`);
  } else {
    const slot = await prisma.featuredSlot.create({
      data: {
        slotNumber: n,
        status: 'VACANT',
      },
    });
    created += 1;
    console.log(`  Slot #${n}: ${c.green}created${c.reset} (id ${slot.id.slice(0, 8)}...)`);
  }
}

console.log(`\n${c.green}✓ Done.${c.reset} ${created} created, ${existing} already existed.`);

// Also make sure the FeaturedSlotConfig row exists with sensible defaults
// (the service auto-creates this too, but we may as well do it here).
const cfg = await prisma.featuredSlotConfig.findUnique({ where: { id: 'default' } });
if (!cfg) {
  await prisma.featuredSlotConfig.create({ data: { id: 'default' } });
  console.log(`${c.green}✓${c.reset} FeaturedSlotConfig created with default tiers`);
} else {
  console.log(`${c.yellow}·${c.reset} FeaturedSlotConfig already present`);
}

await prisma.$disconnect();
