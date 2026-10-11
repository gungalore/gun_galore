// Seed the curated ValuationSource registry for the Value My Item research
// engine. Idempotent: upserts by domain, so re-running never duplicates.
//
// Only VERIFIED-reachable sources are listed. A source is switched on
// per-domain only after the accuracy harness shows it helps
// (docs/valuation-spec.md).
//
// Platform note (probed 2026-10-11): South African outdoor/firearm retail is
// WooCommerce/custom/SPA heavy, NOT Shopify. Outdoor Warehouse and Sportsman's
// Warehouse serve a custom CMS JSON that is not a product feed, and Front
// Runner/Takealot return SPA shells on /products.json. The Shopify adapter is
// kept for when a real Shopify store is found; it is not seeded here.
//
// Usage: node scripts/seed-valuation-sources.mjs

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const WOO = 'WOO';
const MARKETPLACE = 'MARKETPLACE';

// Verified: WooCommerce Store API returns a keyless JSON product array.
const SOURCES = [
  { domain: 'habitatafrica.co.za', label: 'Habitat Africa', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'cityguns.co.za', label: 'City Guns', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'kloppers.co.za', label: 'Kloppers', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'campandclimb.co.za', label: 'Camp & Climb', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'thequartermaster.co.za', label: 'The Quartermaster', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'tacticaldistributors.co.za', label: 'Tactical Distributors SA', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  // Paintball / self-defence specialists (Woo). BNT is Blades & Triggers' shop.
  { domain: 'bntonline.co.za', label: 'Blades & Triggers (BNT)', platform: WOO, roles: ['ANCHOR'], categories: ['paintball', 'self-defence', 'shooting-accessories', 'air-rifles'] },
  { domain: 'dyehard.co.za', label: 'Dye-Hard Paintball', platform: WOO, roles: ['ANCHOR'], categories: ['paintball', 'self-defence'] },
  { domain: 'tippmann.co.za', label: 'Tippmann SA', platform: WOO, roles: ['ANCHOR'], categories: ['paintball', 'self-defence'] },
  { domain: 'safcapshq.co.za', label: 'SAFCAPS', platform: WOO, roles: ['ANCHOR'], categories: ['paintball'] },
  // Fishing specialists (Woo).
  { domain: 'thefishingshop.co.za', label: 'The Fishing Shop', platform: WOO, roles: ['ANCHOR'], categories: ['fishing'] },
  { domain: 'fishsa.co.za', label: 'FishSA', platform: WOO, roles: ['ANCHOR'], categories: ['fishing'] },
  // Verified: server-rendered classifieds, robots-permissive plain GET.
  { domain: 'gunafrica.co.za', label: 'Gun Africa', platform: MARKETPLACE, roles: ['USED'], categories: ['firearms', 'air-rifles', 'optics', 'knives', 'archery-bowhunting', 'reloading-equipment', 'reloading-components', 'shooting-accessories', 'gun-smithing-parts'] },
  // Blocked/JS: need Apify + residential proxies (off until that plan is live).
  { domain: 'gumtree.co.za', label: 'Gumtree', platform: MARKETPLACE, roles: ['USED'], categories: ['*'], needsApify: true },
  { domain: 'facebook.com/marketplace', label: 'Facebook Marketplace', platform: MARKETPLACE, roles: ['USED'], categories: ['*'], needsApify: true },
];

// Domains previously seeded with an unverified platform; remove them.
const STALE = ['outdoorwarehouse.co.za', 'sportsmanswarehouse.co.za', 'frontrunner.co.za', 'bobshop.co.za'];

let created = 0;
let updated = 0;
for (const s of SOURCES) {
  const existing = await prisma.valuationSource.findUnique({ where: { domain: s.domain } });
  await prisma.valuationSource.upsert({
    where: { domain: s.domain },
    create: {
      domain: s.domain,
      label: s.label,
      platform: s.platform,
      roles: s.roles,
      categories: s.categories,
      needsApify: s.needsApify ?? false,
      saVerified: true,
      enabled: false,
      specFields: {},
    },
    update: {
      label: s.label,
      platform: s.platform,
      roles: s.roles,
      categories: s.categories,
      needsApify: s.needsApify ?? false,
    },
  });
  if (existing) updated += 1;
  else created += 1;
}

const removed = await prisma.valuationSource.deleteMany({ where: { domain: { in: STALE } } });
console.log(`ValuationSource seed: ${created} created, ${updated} updated, ${removed.count} stale removed (none enabled).`);
await prisma.$disconnect();
