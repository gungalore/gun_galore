// One-off backfill: re-derive Listing.publicLocality from pickupPostalCode for
// rows created before the postal-area resolver shipped. Safe to re-run — it
// only writes where the label actually changes.
//
//   npm run listings:backfill-locality
//
// Run it once on the box after a backend deploy that includes
// src/listings/postal-locality.ts.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { toPublicLocality } from '../src/listings/locality';
import { resolvePostalArea } from '../src/listings/postal-locality';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  const listings = await prisma.listing.findMany({
    where: { pickupPostalCode: { not: null } },
    select: {
      id: true,
      pickupCity: true,
      pickupSuburb: true,
      pickupPostalCode: true,
      pickupLat: true,
      pickupLng: true,
      publicLocality: true,
    },
  });

  let changed = 0;
  let unresolved = 0;

  for (const listing of listings) {
    const next =
      resolvePostalArea({
        postalCode: listing.pickupPostalCode,
        suburb: listing.pickupSuburb,
        lat: listing.pickupLat,
        lng: listing.pickupLng,
      }) ?? toPublicLocality(listing.pickupCity);

    if (!next) unresolved += 1;
    if (next === listing.publicLocality) continue;

    await prisma.listing.update({
      where: { id: listing.id },
      data: { publicLocality: next },
    });
    changed += 1;
  }

  console.log(
    `Checked ${listings.length} listing(s); updated ${changed}, ` +
      `unresolved ${unresolved}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
