// Test: mint an AUCTION_BID token tied to any active auction listing
// and verify /a/<token> renders the choice + amount-picker UI.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const listing = await prisma.listing.findFirst({
  where: { status: 'ACTIVE', listingType: 'AUCTION' },
  select: { id: true, sellerId: true, endTime: true },
});
if (!listing) {
  console.error('NO_ACTIVE_AUCTION');
  await prisma.$disconnect();
  process.exit(1);
}

const user = await prisma.user.findFirst({
  where: { id: { not: listing.sellerId } },
  select: { id: true },
});
if (!user) {
  console.error('NO_BIDDER_USER');
  await prisma.$disconnect();
  process.exit(1);
}

const token = randomBytes(16)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

await prisma.actionToken.create({
  data: {
    token,
    purpose: 'AUCTION_BID',
    targetType: 'listing',
    targetId: listing.id,
    authorisedUserId: user.id,
    expiresAt: listing.endTime ?? new Date(Date.now() + 24 * 3600_000),
  },
});

const apiResp = await fetch(`http://localhost:3001/api/actions/${token}`);
const apiBody = await apiResp.json();

const feResp = await fetch(`http://localhost:3000/a/${token}`);
const feHtml = await feResp.text().catch(() => '');

console.log('TOKEN_LENGTH=' + token.length);
console.log('API_STATUS=' + apiResp.status);
console.log('API_KIND=' + (apiBody?.kind ?? '?'));
console.log('API_HAS_AUCTION=' + !!apiBody?.auction);
console.log('API_HAS_NEXT_MIN=' + typeof apiBody?.auction?.nextMinBid);
console.log('FE_STATUS=' + feResp.status);
console.log('FE_HAS_LOGO=' + feHtml.includes('logo-mark'));
console.log('FE_HAS_OUTBID_MSG=' + feHtml.includes("outbid"));
console.log('FE_HAS_AUTO_BID_BTN=' + feHtml.includes('Set auto-bid max'));
console.log('FE_HAS_SINGLE_BID_BTN=' + feHtml.includes('Place a single bid'));

await prisma.$disconnect();
