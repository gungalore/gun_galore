// Place a bid directly via Prisma so we can verify the auction panel updates.
// (We bypass the controller because the real flow needs a Clerk JWT.)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

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
  const listingId = process.argv[2];
  const bidderClerkId = process.argv[3];
  const maxAmount = parseInt(process.argv[4], 10);

  if (!listingId || !bidderClerkId || !maxAmount) {
    console.error('usage: tsx dev-place-bid.ts <listingId> <bidderClerkId> <maxAmountCents>');
    process.exit(1);
  }

  const bidder = await prisma.user.upsert({
    where: { clerkId: bidderClerkId },
    create: {
      clerkId: bidderClerkId,
      email: `${bidderClerkId}@test.dev`,
      firstName: bidderClerkId.includes('A') ? 'Anna' : 'Bob',
      lastName: bidderClerkId.includes('A') ? 'Adams' : 'Brown',
    },
    update: {},
  });

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

    const isSameBidder = listing.currentBidderId === bidder.id;
    const currentBid = listing.currentBid ?? 0;

    let visibleBid: number;
    let newHighBidderId: string;

    if (isSameBidder) {
      visibleBid = currentBid > 0 ? currentBid : startingBid;
      newHighBidderId = bidder.id;
    } else if (maxAmount > prevHighMax) {
      const inc = bidIncrement(prevHighMax > 0 ? prevHighMax : startingBid);
      const proposed = (prevHighMax > 0 ? prevHighMax : startingBid - inc) + inc;
      visibleBid = Math.min(maxAmount, proposed);
      if (visibleBid < startingBid) visibleBid = startingBid;
      newHighBidderId = bidder.id;
    } else {
      const inc = bidIncrement(maxAmount);
      visibleBid = Math.min(prevHighMax, maxAmount + inc);
      newHighBidderId = listing.currentBidderId!;
    }

    const reserveMet =
      listing.reservePrice !== null && visibleBid >= listing.reservePrice;

    await tx.bid.create({
      data: { listingId, bidderId: bidder.id, amount: visibleBid, maxAmount },
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

    console.log(`Bid placed by ${bidder.firstName}. Visible bid: R${(visibleBid / 100).toFixed(2)}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
