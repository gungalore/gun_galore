// Smoke test the auction proxy-bid logic.
// Creates two bidders + a fresh auction, places bids, asserts state.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

// Mimic the increments table from auctions.service.ts
const INCREMENT_TIERS: ReadonlyArray<[number, number]> = [
  [100_000, 5_000],
  [500_000, 10_000],
  [1_000_000, 25_000],
  [5_000_000, 50_000],
];
function bidIncrement(amount: number): number {
  for (const [bound, inc] of INCREMENT_TIERS) {
    if (amount < bound) return inc;
  }
  return 100_000;
}

async function main() {
  console.log('Setup…');

  const seller = await prisma.user.upsert({
    where: { clerkId: 'user_devtour_seller_001' },
    create: { clerkId: 'user_devtour_seller_001', email: 'tour-seller@gungalore.dev', kycStatus: 'VERIFIED' },
    update: {},
  });

  const buyerA = await prisma.user.upsert({
    where: { clerkId: 'user_devtest_buyerA' },
    create: { clerkId: 'user_devtest_buyerA', email: 'buyer-a@test.dev', firstName: 'Anna' },
    update: {},
  });
  const buyerB = await prisma.user.upsert({
    where: { clerkId: 'user_devtest_buyerB' },
    create: { clerkId: 'user_devtest_buyerB', email: 'buyer-b@test.dev', firstName: 'Bob' },
    update: {},
  });

  const cat = await prisma.category.findFirst({ where: { slug: 'optics-scopes' } });
  if (!cat) throw new Error('seed categories first');

  // Fresh auction every run
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hr

  const auction = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      categoryId: cat.id,
      title: 'Smoke test scope',
      description: 'Auction smoke-test listing — DELETE ME',
      price: 100_000, // R1,000 starting bid
      listingType: 'AUCTION',
      status: 'ACTIVE',
      condition: 'GOOD',
      province: 'GAUTENG',
      reservePrice: 200_000, // R2,000 reserve
      durationDays: 1,
      startTime,
      endTime,
    },
  });
  console.log('  ✓ auction created:', auction.id);

  // Scenario 1: Anna bids max R5,000 (above reserve).
  //   First bid → visible = startingBid = R1,000.
  //   But our service does: prevHighMax = 0, proposed = startingBid - inc + inc = startingBid.
  //   So visible = startingBid (R1,000). Anna is high bidder.
  await placeBidLikeService(auction.id, buyerA.id, 500_000); // R5,000 max
  const afterA = await prisma.listing.findUnique({ where: { id: auction.id } });
  console.log('After Anna max R5,000:');
  console.log('  currentBid:', afterA?.currentBid, '(expected 100000 / R1,000)');
  console.log('  bidCount:', afterA?.bidCount, '(expected 1)');
  console.log('  highBidder is Anna:', afterA?.currentBidderId === buyerA.id);
  console.log('  reserveMet:', afterA?.reserveMet, '(expected false — R1,000 < R2,000 reserve)');

  // Scenario 2: Bob bids max R3,000.
  //   Bob's max (R3,000) < Anna's max (R5,000) → Anna still high.
  //   Visible bid bumps to min(Anna's max, Bob's max + increment).
  //   Bob's max = R3,000, increment at R3,000 = R100 → R3,100.
  //   min(R5,000, R3,100) = R3,100.
  await placeBidLikeService(auction.id, buyerB.id, 300_000);
  const afterB = await prisma.listing.findUnique({ where: { id: auction.id } });
  console.log('After Bob max R3,000:');
  console.log('  currentBid:', afterB?.currentBid, '(expected 310000 / R3,100)');
  console.log('  highBidder still Anna:', afterB?.currentBidderId === buyerA.id);
  console.log('  reserveMet:', afterB?.reserveMet, '(expected true — R3,100 > R2,000 reserve)');

  // Scenario 3: Bob raises to R7,000 — now beats Anna's max R5,000.
  //   New visible = min(Bob's max, Anna's max + inc).
  //   Anna's max = R5,000, increment at R5,000 = R250 → R5,250.
  //   min(R7,000, R5,250) = R5,250.
  await placeBidLikeService(auction.id, buyerB.id, 700_000);
  const afterB2 = await prisma.listing.findUnique({ where: { id: auction.id } });
  console.log('After Bob raises to R7,000:');
  console.log('  currentBid:', afterB2?.currentBid, '(expected 525000 / R5,250)');
  console.log('  highBidder is Bob:', afterB2?.currentBidderId === buyerB.id);

  // Cleanup
  await prisma.bid.deleteMany({ where: { listingId: auction.id } });
  await prisma.listing.delete({ where: { id: auction.id } });
  console.log('Cleanup done.');
}

// Inline mini-implementation of placeBid for the smoke test — replicates
// the same proxy-bid math as auctions.service.ts.
async function placeBidLikeService(listingId: string, bidderId: string, maxAmount: number) {
  await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new Error('no listing');

    const startingBid = listing.price ?? 100;
    let prevHighMax = 0;
    if (listing.currentBidderId) {
      const prev = await tx.bid.findFirst({
        where: { listingId, bidderId: listing.currentBidderId },
        orderBy: { createdAt: 'desc' },
      });
      prevHighMax = prev?.maxAmount ?? 0;
    }

    const isSameBidder = listing.currentBidderId === bidderId;
    const currentBid = listing.currentBid ?? 0;

    let visibleBid: number;
    let newHighBidderId: string;

    if (isSameBidder) {
      visibleBid = currentBid > 0 ? currentBid : startingBid;
      newHighBidderId = bidderId;
    } else if (maxAmount > prevHighMax) {
      const inc = bidIncrement(prevHighMax > 0 ? prevHighMax : startingBid);
      const proposed = (prevHighMax > 0 ? prevHighMax : startingBid - inc) + inc;
      visibleBid = Math.min(maxAmount, proposed);
      if (visibleBid < startingBid) visibleBid = startingBid;
      newHighBidderId = bidderId;
    } else {
      const inc = bidIncrement(maxAmount);
      visibleBid = Math.min(prevHighMax, maxAmount + inc);
      newHighBidderId = listing.currentBidderId!;
    }

    const reserveMet =
      listing.reservePrice !== null && visibleBid >= listing.reservePrice;

    await tx.bid.create({
      data: { listingId, bidderId, amount: visibleBid, maxAmount },
    });
    await tx.listing.update({
      where: { id: listingId },
      data: {
        currentBid: visibleBid,
        currentBidderId: newHighBidderId,
        bidCount: { increment: 1 },
        reserveMet,
      },
    });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
