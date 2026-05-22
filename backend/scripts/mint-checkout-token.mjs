// Test: mint a CHECKOUT-purpose token tied to an existing BUY_NOW
// active listing + its accepted-offer buyer (or any user). Then
// verify the /a/<token> redirect AND the /checkout/[id]?t=<token>
// page renders without Clerk auth.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Find any active BUY_NOW listing + any user to act as the buyer.
const listing = await prisma.listing.findFirst({
  where: { status: 'ACTIVE', listingType: 'BUY_NOW' },
  select: { id: true, sellerId: true },
});
if (!listing) {
  console.error('NO_ACTIVE_BUY_NOW_LISTING');
  await prisma.$disconnect();
  process.exit(1);
}

// Use any other user (not the seller) as the "buyer".
const buyer = await prisma.user.findFirst({
  where: { id: { not: listing.sellerId } },
  select: { id: true },
});
if (!buyer) {
  console.error('NO_BUYER_USER');
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
    purpose: 'CHECKOUT',
    targetType: 'listing',
    targetId: listing.id,
    authorisedUserId: buyer.id,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  },
});

// 1. API resolve — should return CHECKOUT payload with redirectTo
const apiResp = await fetch(`http://localhost:3001/api/actions/${token}`);
const apiBody = await apiResp.json();

// 2. /a/<token> page — should 307 redirect to /checkout/[id]?t=<token>
const entryResp = await fetch(`http://localhost:3000/a/${token}`, {
  redirect: 'manual',
});

// 3. /checkout/[id]?t=<token> page — should render WITHOUT Clerk
const checkoutResp = await fetch(
  `http://localhost:3000/checkout/${listing.id}?t=${token}`,
  { redirect: 'manual' },
);
const checkoutHtml = await checkoutResp.text().catch(() => '');

// 4. Backend /api/users/me with token — should resolve to buyer
const userResp = await fetch(
  `http://localhost:3001/api/users/me?t=${token}`,
);
const userBody = await userResp.json();

console.log('TOKEN_LENGTH=' + token.length);
console.log('API_STATUS=' + apiResp.status);
console.log('API_KIND=' + (apiBody?.kind ?? '?'));
console.log('API_REDIRECT=' + (apiBody?.redirectTo ?? '?'));
console.log('ENTRY_STATUS=' + entryResp.status);
console.log(
  'ENTRY_LOCATION=' + (entryResp.headers.get('location') ?? '?'),
);
console.log('CHECKOUT_STATUS=' + checkoutResp.status);
console.log(
  'CHECKOUT_HAS_PAY_BUTTON=' + /Pay /.test(checkoutHtml),
);
console.log('USER_ME_STATUS=' + userResp.status);
console.log('USER_ME_HAS_ID=' + !!userBody?.id);

await prisma.$disconnect();
