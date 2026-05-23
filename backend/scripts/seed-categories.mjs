// Seed / refresh the canonical category tree on whatever DATABASE_URL
// the surrounding env points at.
//
// Why this script exists separately from prisma/seed.ts:
//   * `prisma/seed.ts` also re-seeds 5 TEST dealers (TEST-GP-001 etc.)
//     and the seed admin user — both of which we DON'T want to push
//     into a production database.
//   * Re-running the full seed on prod would re-introduce the test
//     dealers if they'd been pruned.
//
// What it does:
//   1. Deactivate every existing category (isActive = false). Anything
//      not in our seed below stays inactive — old listings keep their
//      FK reference, but the category disappears from pickers.
//   2. Upsert the 14 parent categories + ~110 sub-categories by slug,
//      reactivating + refreshing flags as we go.
//
// Idempotent. Safe to re-run any time the canonical tree changes.
//
// Run locally (against the dev DB):
//   cd backend && node scripts/seed-categories.mjs
//
// Run on production:
//   ssh gungalore "cd ~/app/backend && node scripts/seed-categories.mjs"

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── CANONICAL CATEGORY TREE ────────────────────────────────────────
// MUST stay in sync with prisma/seed.ts. The reason this is duplicated
// is so we can run categories-only on production without dragging the
// test dealers along. If you change one, change both.

const categories = [
  { name: 'Air Rifles', slug: 'air-rifles', sortOrder: 1 },
  { name: 'Ammo', slug: 'ammo', sortOrder: 2, availableSecondhand: false, availableNewStore: true },
  { name: 'Cleaning Equipment', slug: 'cleaning-equipment', sortOrder: 3, availableNewStore: true },
  { name: 'Firearms', slug: 'firearms', sortOrder: 4, isFirearm: true, requiresLicence: true },
  { name: 'Gun Smithing & Parts', slug: 'gun-smithing-parts', sortOrder: 5, availableNewStore: true },
  { name: 'Optics', slug: 'optics', sortOrder: 6, availableNewStore: true },
  { name: 'Reloading Components', slug: 'reloading-components', sortOrder: 7, availableNewStore: true },
  { name: 'Shooting Accessories', slug: 'shooting-accessories', sortOrder: 8, availableNewStore: true },
  { name: 'Fishing', slug: 'fishing', sortOrder: 9, availableNewStore: true },
  { name: 'Camping & Outdoor', slug: 'camping-outdoor', sortOrder: 10, availableNewStore: true },
  { name: 'Knives', slug: 'knives', sortOrder: 11, availableNewStore: true },
  { name: 'Self Defence', slug: 'self-defence', sortOrder: 12, availableNewStore: true },
  { name: 'Paintball', slug: 'paintball', sortOrder: 13, availableNewStore: true },
  { name: 'Reloading Equipment', slug: 'reloading-equipment', sortOrder: 14, availableNewStore: true },
];

const subCategories = {
  'air-rifles': [
    { name: 'Air Pistols' },
    { name: 'Air Rifle Pellets' },
    { name: 'Air Rifle Traps & Accessories' },
    { name: 'Air Rifles Springer' },
    { name: 'Air Rifles PCP' },
    { name: 'Airsoft' },
  ],
  'cleaning-equipment': [
    { name: 'Solvents' },
    { name: 'Sundry Equipment' },
    { name: 'Jags & Rods' },
    { name: 'Jags, Mops & Brushes' },
    { name: 'Cleaning Kits' },
  ],
  firearms: [
    { name: 'Pistols' },
    { name: 'Centerfire Rifles' },
    { name: 'Semi-Automatic Rifles' },
    { name: 'Double Rifles' },
    { name: 'Bespoke Rifles' },
    { name: 'Revolvers' },
    { name: 'Rimfire Rifles' },
    { name: 'Over & Under Shotguns' },
    { name: 'Semi-Automatic Shotguns' },
    { name: 'Pump Action Shotguns' },
  ],
  'gun-smithing-parts': [
    { name: 'Actions' },
    { name: 'Barrels', licenced: true },
    { name: 'Rifle Parts & Screws' },
    { name: 'Rifle Stocks' },
    { name: 'Rifle Tools' },
    { name: 'Silencers' },
    { name: 'Triggers' },
    { name: "Men's Hunting Pants & Shorts" },
    { name: 'AR Accessories' },
    { name: 'AR Magazines' },
    { name: 'Pistol Magazines' },
  ],
  optics: [
    { name: 'Rifle Scopes' },
    { name: 'Binoculars' },
    { name: 'Rangefinders' },
    { name: 'Optical Cleaning Equipment' },
    { name: 'Night Vision' },
    { name: 'Spotting Scopes' },
    { name: 'Optical Tripods & Window Mounts' },
    { name: 'Scope Mounts' },
    { name: 'Air Rifle Scopes' },
    { name: 'Handgun Scopes' },
    { name: 'Trail Cameras' },
    { name: 'Rimfire Rifle Scopes' },
    { name: 'Rangefinder Binoculars' },
    { name: 'Rangefinding Rifle Scopes' },
    { name: 'Previously Owned Optics' },
    { name: 'Optical Accessories' },
  ],
  'reloading-components': [
    { name: 'Rifle Bullets' },
    { name: 'Rifle Brass Cases' },
    { name: 'Handgun Bullets' },
    { name: 'Handgun Brass Cases' },
  ],
  'reloading-equipment': [
    { name: 'Reloading Dies' },
    { name: 'Reloading Scales' },
    { name: 'Measures' },
    { name: 'Reloading Presses' },
    { name: 'Reloading Kits' },
    { name: 'Reloading Sundry Equipment' },
  ],
  'shooting-accessories': [
    { name: 'Ammo Boxes & Storage Cases' },
    { name: 'Ballistic Software' },
    { name: 'Bore Sighters' },
    { name: 'Calling Equipment' },
    { name: 'Chronographs' },
    { name: 'Protection' },
    { name: 'Holster' },
    { name: 'Rest Bipods & Shooting Sticks' },
    { name: 'Rest X-Bags & Rear Bags' },
    { name: 'Rifle Bags' },
    { name: 'Rifle Safes' },
    { name: 'Rifle Slings & Straps' },
    { name: 'Targets & Stands' },
    { name: 'Windmeters' },
    { name: 'Weapons Mounted Lights' },
    { name: 'Ammo Pouch' },
  ],
  fishing: [
    { name: 'Reels' },
    { name: 'Rods' },
    { name: 'Lures' },
    { name: 'Carp Baits' },
    { name: 'Lines' },
    { name: 'Terminal Tackle' },
    { name: 'Fishing Apparel' },
    { name: 'Fishing Footwear' },
    { name: 'Fishing Accessories' },
    { name: 'Fishing By Technique' },
    { name: 'Fishing Headwear' },
  ],
  'camping-outdoor': [
    { name: 'Lights' },
    { name: 'Camping & Outdoor Accessories' },
    { name: 'Sleeping Bags, Mattresses & Stretchers' },
    { name: 'Camping Furniture' },
    { name: 'Kids Camping' },
    { name: 'Outdoor Gear' },
  ],
  knives: [
    { name: 'Custom Knives' },
    { name: 'Tactical Knives' },
    { name: 'Hunting Knives' },
    { name: 'Pocket Knives' },
    { name: 'Multitools' },
    { name: 'Knife Sets' },
    { name: 'Knife Sharpeners & Sundries' },
    { name: 'Axes' },
    { name: 'Biltong Cutters' },
    { name: 'Kitchen Knives' },
    { name: 'Knife & Multitool Pouches' },
    { name: 'Fishing Knives' },
    { name: 'Accessories Knives' },
  ],
  'self-defence': [
    { name: 'Pepper Sprays' },
    { name: 'Launchers' },
    { name: 'Body Armour & Plate Carriers' },
    { name: 'Stun Guns & Batons' },
    { name: 'Projectiles and Accessories' },
  ],
  paintball: [
    { name: 'Paintball Accessories' },
    { name: 'Paintball Masks' },
    { name: 'Paintball Markers' },
    { name: 'Paintball Barrels' },
    { name: 'Paintball Ammo' },
    { name: 'Paintball Hoppers & Accessories' },
  ],
  ammo: [],
};

async function main() {
  const beforeActive = await prisma.category.count({ where: { isActive: true } });
  const beforeTotal = await prisma.category.count();
  console.log(`Before: ${beforeActive} active / ${beforeTotal} total`);

  console.log('Deactivating stale categories…');
  await prisma.category.updateMany({ data: { isActive: false } });

  console.log('Seeding parent categories…');
  for (const cat of categories) {
    const data = {
      name: cat.name,
      slug: cat.slug,
      isFirearm: cat.isFirearm ?? false,
      requiresLicence: cat.requiresLicence ?? false,
      availableSecondhand: cat.availableSecondhand ?? true,
      availableNewStore: cat.availableNewStore ?? false,
      sortOrder: cat.sortOrder,
      isActive: true,
      parentId: null,
    };
    await prisma.category.upsert({
      where: { slug: cat.slug },
      create: data,
      update: data,
    });
    console.log(`  ✓ ${cat.name}`);
  }

  console.log('Seeding sub-categories…');
  for (const [parentSlug, children] of Object.entries(subCategories)) {
    const parent = await prisma.category.findUnique({ where: { slug: parentSlug } });
    if (!parent) {
      console.warn(`  ! missing parent: ${parentSlug}`);
      continue;
    }
    for (const [i, child] of children.entries()) {
      const childSlug = `${parentSlug}--${slugify(child.name)}`;
      const isFirearm = child.licenced ? true : parent.isFirearm;
      const requiresLicence = child.licenced ? true : parent.requiresLicence;
      const data = {
        name: child.name,
        slug: childSlug,
        parentId: parent.id,
        isFirearm,
        requiresLicence,
        availableSecondhand: parent.availableSecondhand,
        availableNewStore: parent.availableNewStore,
        sortOrder: i + 1,
        isActive: true,
      };
      await prisma.category.upsert({
        where: { slug: childSlug },
        create: data,
        update: data,
      });
    }
    console.log(`  ✓ ${parent.name}: ${children.length} sub-categories`);
  }

  const afterActive = await prisma.category.count({ where: { isActive: true } });
  const afterTotal = await prisma.category.count();
  console.log(`After:  ${afterActive} active / ${afterTotal} total`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
