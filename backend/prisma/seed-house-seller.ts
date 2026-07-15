import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Daily Deals house-seller seeder (DD-1) ──────────────────────────
// First-party "OneDayOnly-style" Daily Deals are all filed under a single
// system User row — the "house seller". Every Deal listing has this row as
// its sellerId so the existing seller/transaction/payout machinery keeps
// working unchanged, while `isDealListing = true` keeps the listing out of
// every public marketplace surface.
//
//   npm run seed:house
//
// Idempotent:
//  - Upserts the house User on its stable clerkId `system_house_seller`
//    (a synthetic id — this account has no real Clerk session and never
//    signs in). Reruns leave an existing row's mutable fields alone.
//  - Records the resolved User.id in Setting('house_seller_user_id') so
//    DealsService can resolve the house seller without a hardcoded id.
//
// The account is pre-verified (kycStatus VERIFIED, profileCompletedAt set)
// so deal listings never trip the seller KYC/profile gates. It carries NO
// banking details — first-party deal payouts settle to the platform, not
// through the normal seller-payout rail (that's a DD-2 money concern).

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const HOUSE_CLERK_ID = 'system_house_seller';
const HOUSE_EMAIL = 'deals@gungalore.co.za';
const HOUSE_USERNAME = 'gungalore_official';

async function main() {
  const now = new Date();

  const house = await prisma.user.upsert({
    where: { clerkId: HOUSE_CLERK_ID },
    // Don't clobber operator edits (e.g. a swapped username) on rerun.
    update: {},
    create: {
      clerkId: HOUSE_CLERK_ID,
      email: HOUSE_EMAIL,
      username: HOUSE_USERNAME,
      firstName: 'Gun Galore',
      sellerTier: 'DEALER',
      kycStatus: 'VERIFIED',
      kycVerifiedAt: now,
      profileCompletedAt: now,
    },
    select: { id: true, email: true, username: true },
  });

  await prisma.setting.upsert({
    where: { key: 'house_seller_user_id' },
    create: { key: 'house_seller_user_id', value: house.id },
    update: { value: house.id },
  });

  console.log(
    `House-seller seed complete: user ${house.id} ` +
      `(${house.username} / ${house.email}), ` +
      `Setting('house_seller_user_id') = ${house.id}.`,
  );
}

main()
  .catch((e) => {
    console.error('[seed:house] FAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
