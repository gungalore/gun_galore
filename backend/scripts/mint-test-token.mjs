// One-off test: mint an OFFER_DECISION token tied to the most recent
// offer in the DB, then resolve it via the public API and render via
// the frontend. Reports only structural info — no PII surfaces.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const offer = await prisma.offer.findFirst({
  orderBy: { createdAt: 'desc' },
  select: { id: true, listing: { select: { sellerId: true } } },
});

if (!offer) {
  console.error('NO_OFFER');
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
    purpose: 'OFFER_DECISION',
    targetType: 'offer',
    targetId: offer.id,
    authorisedUserId: offer.listing.sellerId,
    expiresAt: new Date(Date.now() + 3600_000),
  },
});

// API resolve
const apiResp = await fetch(`http://localhost:3001/api/actions/${token}`);
const apiBody = await apiResp.json();

// Frontend render
const feResp = await fetch(`http://localhost:3000/a/${token}`, {
  redirect: 'manual',
});
const feHtml = await feResp.text().catch(() => '');

console.log('TOKEN_LENGTH=' + token.length);
console.log('API_STATUS=' + apiResp.status);
console.log('API_KIND=' + (apiBody?.kind ?? '?'));
console.log('API_HAS_LISTING=' + !!apiBody?.listing?.title);
console.log('API_HAS_OFFER_AMOUNT=' + (typeof apiBody?.offer?.amount === 'number'));
console.log('FE_STATUS=' + feResp.status);
console.log('FE_HAS_LOGO=' + feHtml.includes('logo-mark'));
console.log('FE_HAS_ACCEPT_BUTTON=' + /Accept R/.test(feHtml));
console.log('FE_HAS_COUNTER_BUTTON=' + feHtml.includes('Counter offer'));
console.log('FE_HAS_REJECT_BUTTON=' + feHtml.includes('Reject'));
console.log(
  'FE_HAS_LISTING_TITLE=' + feHtml.includes(apiBody?.listing?.title ?? '__nope__'),
);

await prisma.$disconnect();
