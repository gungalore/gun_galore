// Quick read-only check on the Bid table — verifies the proxy-counter
// dual-row refactor is writing rows correctly. Prints the 20 most
// recent bids across all listings with: row id, bidder username,
// visible amount, stored maxAmount, listing title, timestamp.
//
// Run from the backend dir:
//   npx ts-node scripts/check-bids.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load DATABASE_URL from the backend .env so the standalone script
// can connect the same way the running NestJS app does.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  const bids = await prisma.bid.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      id: true,
      amount: true,
      maxAmount: true,
      createdAt: true,
      bidder: {
        select: { username: true, firstName: true, lastName: true },
      },
      listing: {
        select: { id: true, title: true, currentBidderId: true },
      },
      bidderId: true,
    },
  });

  console.log('\nLatest 20 bid rows (newest first):\n');
  console.log(
    'IS_HIGH  USERNAME              VISIBLE     MAX        ATTEMPT  LISTING'.padEnd(
      120,
    ),
  );
  console.log('-'.repeat(120));

  for (const b of bids) {
    const isHigh = b.listing.currentBidderId === b.bidderId ? 'YES' : '   ';
    const username = (b.bidder.username ?? '(no-handle)').padEnd(20);
    const visible = `R${(b.amount / 100).toLocaleString('en-ZA')}`.padEnd(10);
    const max = `R${(b.maxAmount / 100).toLocaleString('en-ZA')}`.padEnd(10);
    // amount > maxAmount means the bidder was beaten by an existing
    // proxy (old single-row pattern). amount === maxAmount means
    // they posted at their stated amount. amount < maxAmount means
    // they posted via proxy (their max higher than visible).
    const attempt =
      b.amount > b.maxAmount
        ? 'BEATEN'
        : b.amount === b.maxAmount
          ? 'EXACT '
          : 'PROXY ';
    const title = b.listing.title.slice(0, 40);
    console.log(
      `  ${isHigh}     ${username}  ${visible} ${max}  ${attempt}   ${title}`,
    );
  }

  // Show recent listings with current bidder for sanity.
  console.log('\nRecent listings with an active high bidder:\n');
  const listings = await prisma.listing.findMany({
    where: { currentBidderId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      currentBid: true,
      bidCount: true,
      currentBidder: { select: { username: true } },
    },
  });
  for (const l of listings) {
    console.log(
      `  "${l.title.slice(0, 40)}" — R${(l.currentBid! / 100).toLocaleString('en-ZA')} (${l.bidCount} bids) — high: ${l.currentBidder?.username ?? '?'}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
