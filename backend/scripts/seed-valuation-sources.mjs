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
const SHOPIFY = 'SHOPIFY';
const MARKETPLACE = 'MARKETPLACE';
const SITEMAP_HTML = 'SITEMAP_HTML';
const HTML = 'HTML';
const SCRAPEWISE = 'SCRAPEWISE';

// Verified: WooCommerce Store API returns a keyless JSON product array.
const SOURCES = [
  { domain: 'habitatafrica.co.za', label: 'Habitat Africa', platform: WOO, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'outdoorwarehouse.co.za', label: 'Outdoor Warehouse', platform: SITEMAP_HTML, roles: ['ANCHOR'], categories: ['camping-outdoor', 'overlanding', 'hunting', 'fishing', 'outdoor-clothing-footwear'] },
  { domain: 'safarioutdoor.co.za', label: 'Safari Outdoor', platform: SITEMAP_HTML, roles: ['ANCHOR'], categories: ['firearms', 'air-rifles', 'optics', 'reloading-equipment', 'reloading-components', 'knives', 'hunting', 'camping-outdoor', 'fishing', 'outdoor-clothing-footwear', 'archery-bowhunting'] },
  { domain: '4x4megaworldonline.com', label: '4x4 Mega World', platform: WOO, roles: ['ANCHOR'], categories: ['overlanding', 'camping-outdoor', 'hunting', 'shooting-accessories'] },
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
  // Blocked/JS/SPA retailers: read via the Scrapewise render lane.
  { domain: 'gumtree.co.za', label: 'Gumtree', platform: SCRAPEWISE, roles: ['USED'], categories: ['*'] },
  { domain: '247hunter.co.za', label: '247 Hunter', platform: SCRAPEWISE, roles: ['USED'], categories: ['firearms', 'optics', 'hunting', 'knives', 'shooting-accessories'] },
  { domain: 'bluewatergear.co.za', label: 'Blue Water Gear', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['fishing'] },
  { domain: 'davesheer.com', label: 'Dave Sheer Firearms', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'shooting-accessories', 'reloading-equipment'] },
  { domain: 'decathlon.co.za', label: 'Decathlon South Africa', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['camping-outdoor', 'overlanding', 'outdoor-clothing-footwear'] },
  { domain: 'melvillandmoon.com', label: 'Melvill & Moon', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['camping-outdoor', 'overlanding'] },
  { domain: 'terraintamer.com', label: 'Terrain Tamer South Africa', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['overlanding'] },
  // Big retailers that JS/Cloudflare-block our own fetch.
  { domain: 'capeunionmart.co.za', label: 'Cape Union Mart', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'gunsbows.co.za', label: 'Guns & Bows', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'air-rifles', 'optics', 'shooting-accessories', 'archery-bowhunting', 'knives', 'hunting'] },
  // Added from the leftover shop list (verified SA + reachable).
  { domain: 'knifeguy.co.za', label: 'The Knife Guy', platform: SHOPIFY, roles: ['ANCHOR'], categories: ['knives', 'shooting-accessories', 'self-defence'] },
  { domain: 'orpenwapens.co.za', label: 'Orpen Wapens', platform: WOO, roles: ['ANCHOR'], categories: ['firearms', 'reloading-equipment', 'reloading-components', 'shooting-accessories', 'optics'] },
  { domain: 'wildmanhuntingandoutdoor.com', label: 'Wildman', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'lynx.co.za', label: 'Lynx Optics', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['optics'] },
  { domain: 'vectoroptics-africa.com', label: 'Vector Optics Africa', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['optics', 'shooting-accessories'] },
  { domain: 'tacticallyarmed.co.za', label: 'Tactically Armed', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'shooting-accessories', 'knives', 'self-defence', 'optics'] },
  { domain: 'takla.co.za', label: 'Takla Products', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['overlanding', 'camping-outdoor'] },
  { domain: 'spearfishingsa.co.za', label: 'Spearfishing South Africa', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['fishing'] },
  { domain: 'accuratearms.co.za', label: 'Accurate Arms', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'gun-smithing-parts', 'optics'] },
  { domain: 'outdoorandvelocity.co.za', label: 'Outdoor & Velocity', platform: WOO, roles: ['ANCHOR'], categories: ['paintball', 'air-rifles', 'shooting-accessories', 'self-defence', 'camping-outdoor'] },
  { domain: 'makro.co.za', label: 'Makro', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'frontrunneroutfitters.com', label: 'Front Runner', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['overlanding', 'camping-outdoor'] },
  // Used classifieds forum reachable by plain GET (bounded recent-listings crawl).
  { domain: 'jaracal.com', label: 'Jaracal', platform: MARKETPLACE, roles: ['USED'], categories: ['firearms', 'optics', 'reloading-equipment', 'reloading-components', 'shooting-accessories', 'knives', 'hunting', 'air-rifles', 'paintball', 'archery', 'outdoor-clothing-footwear', 'camping-outdoor', 'fishing', 'self-defence'] },
  // SA precision/chassis maker on Shopify (readable now).
  { domain: 'aimengineering.co.za', label: 'AIM Engineering', platform: SHOPIFY, roles: ['ANCHOR'], categories: ['firearms', 'shooting-accessories', 'optics', 'reloading-equipment', 'hunting'] },
  // SA precision parts makers on WooCommerce (Store API readable).
  { domain: 'axisprecisionworx.com', label: 'Axis Precision Worx', platform: WOO, roles: ['ANCHOR'], categories: ['firearms', 'shooting-accessories', 'optics'] },
  { domain: 'impactproshop.net', label: 'Impact Pro Shop', platform: WOO, roles: ['ANCHOR'], categories: ['firearms', 'shooting-accessories', 'optics', 'hunting'] },
  // Big retailer on Shopify (readable now).
  { domain: 'quenets.com', label: 'Quenets', platform: SHOPIFY, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'shooting-accessories', 'air-rifles', 'knives', 'hunting', 'reloading-equipment'] },
  // Custom/no-feed retailers read by the Scrapewise render lane (JS/anti-bot).
  { domain: 'sportsmanswarehouse.co.za', label: 'Sportsmans Warehouse', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['*'] },
  { domain: 'camdix.co.za', label: 'Camdix', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'reloading-equipment', 'shooting-accessories', 'knives', 'hunting'] },
  { domain: 'kingsfirearms.co.za', label: 'Kings Firearms', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'shooting-accessories', 'reloading-equipment'] },
  { domain: 'chsguns.co.za', label: 'CHS Guns', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'reloading-components', 'shooting-accessories'] },
  { domain: 'gunsammo.co.za', label: 'Guns & Ammo', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'shooting-accessories'] },
  { domain: 'nationalluna.com', label: 'National Luna', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['overlanding', 'camping-outdoor'] },
  { domain: 'frontierbullets.co.za', label: 'Frontier Bullets', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['reloading-components'] },
  { domain: 'impalabullets.co.za', label: 'Impala Bullets', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['reloading-components'] },
  { domain: 'stewartbullets.co.za', label: 'Stewart Bullets', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['reloading-components'] },
  // Wix/JS storefronts: read via the Scrapewise render lane.
  { domain: 'gunwarrior.co.za', label: 'Gun Warrior', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'shooting-accessories', 'optics'] },
  { domain: 'musgraverifles.co.za', label: 'Musgrave Rifles', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms'] },
  // Cloudflare-blocked Magento retailer: read via the Scrapewise render lane.
  { domain: 'futurama.co.za', label: 'Futurama', platform: SCRAPEWISE, roles: ['ANCHOR'], categories: ['firearms', 'optics', 'air-rifles', 'reloading-equipment', 'reloading-components', 'shooting-accessories', 'knives', 'hunting', 'paintball'] },
];

// Domains previously seeded with an unverified platform; remove them.
const STALE = ['frontrunner.co.za', 'bobshop.co.za', 'junkmail.co.za', 'facebook.com/marketplace', 'takealot.com'];

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
