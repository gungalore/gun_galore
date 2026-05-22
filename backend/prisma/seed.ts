import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── CANONICAL CATEGORY TREE ────────────────────────────────────────────
// Imported from the original Gun Galore project (docs/design folder).
// 14 parent categories, ~110 sub-categories. Structure rules:
//   - `isFirearm: true` → category contains items legally classified as firearms
//   - `requiresLicence: true` → must ship via licensed-dealer transfer (SAPS rule)
//   - `availableSecondhand: false` → hidden from the used marketplace Sell form
//     (used for live ammo categories where private resale is banned)
//   - `availableNewStore: true` → appears on the dealer New Store (M3)
//
// Children inherit the parent's flags unless overridden (e.g. Barrels under
// Gun Smithing has requiresLicence=true while siblings don't).

interface ParentCat {
  name: string;
  slug: string;
  isFirearm?: boolean;
  requiresLicence?: boolean;
  availableSecondhand?: boolean;
  availableNewStore?: boolean;
  sortOrder: number;
}

const categories: ParentCat[] = [
  { name: 'Air Rifles', slug: 'air-rifles', sortOrder: 1 },
  // Live ammo cannot be sold between private individuals on the used
  // marketplace — only available on the dealer New Store (M3).
  { name: 'Ammo', slug: 'ammo', sortOrder: 2, availableSecondhand: false, availableNewStore: true },
  { name: 'Cleaning Equipment', slug: 'cleaning-equipment', sortOrder: 3, availableNewStore: true },
  // The Firearms parent — all sub-categories require dealer transfer.
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

// Sub-categories keyed by parent slug. Each child inherits the parent's
// isFirearm/requiresLicence/etc. flags unless explicitly overridden via
// `licenced: true` (only used for Barrels under Gun Smithing).
interface SubCat {
  name: string;
  licenced?: boolean; // Override — flips both isFirearm + requiresLicence to true
}

const subCategories: Record<string, SubCat[]> = {
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
  // All Firearms sub-categories inherit isFirearm + requiresLicence from parent.
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
    // Barrels are licence-required per SA firearm regulations — dealer
    // transfer only, no Pudo/TCG. (See CLAUDE.md "Absolute Rules".)
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
  // Ammo has no sub-categories — it's a single-pill parent under New Store.
  ammo: [],
};

// Test dealers — replace with real SAPS-licensed dealers before production launch.
// Coordinates are approximate city centres.
const dealers = [
  {
    licenceNumber: 'TEST-GP-001',
    name: 'Centurion Arms & Ammo',
    address: '123 John Vorster Drive',
    suburb: 'Centurion',
    city: 'Centurion',
    province: 'GAUTENG' as const,
    postalCode: '0157',
    lat: -25.8553,
    lng: 28.1881,
    phone: '012 000 0001',
    email: 'info@centurionarms.test',
  },
  {
    licenceNumber: 'TEST-GP-002',
    name: 'Joburg Firearms & Accessories',
    address: '456 Commissioner Street',
    suburb: 'Johannesburg CBD',
    city: 'Johannesburg',
    province: 'GAUTENG' as const,
    postalCode: '2001',
    lat: -26.2041,
    lng: 28.0473,
    phone: '011 000 0002',
    email: 'info@joburgfirearms.test',
  },
  {
    licenceNumber: 'TEST-WC-001',
    name: 'Cape Arms Dealers',
    address: '789 Voortrekker Road',
    suburb: 'Bellville',
    city: 'Cape Town',
    province: 'WESTERN_CAPE' as const,
    postalCode: '7530',
    lat: -33.9249,
    lng: 18.4241,
    phone: '021 000 0003',
    email: 'info@capearmstest.test',
  },
  {
    licenceNumber: 'TEST-KZN-001',
    name: 'Durban Firearms Centre',
    address: '321 Old Main Road',
    suburb: 'Pinetown',
    city: 'Durban',
    province: 'KWAZULU_NATAL' as const,
    postalCode: '3610',
    lat: -29.8179,
    lng: 30.8593,
    phone: '031 000 0004',
    email: 'info@durbanfirearms.test',
  },
  {
    licenceNumber: 'TEST-EC-001',
    name: 'Port Elizabeth Arms',
    address: '654 Uitenhage Road',
    suburb: 'Korsten',
    city: 'Port Elizabeth',
    province: 'EASTERN_CAPE' as const,
    postalCode: '6020',
    lat: -33.9608,
    lng: 25.6022,
    phone: '041 000 0005',
    email: 'info@pearms.test',
  },
];

async function main() {
  // Deactivate every existing category first. Anything still in our seed
  // gets reactivated below; anything obsolete stays inactive (so old
  // listings keep their FK reference but disappear from the picker).
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
    const parent = await prisma.category.findUnique({
      where: { slug: parentSlug },
    });
    if (!parent) {
      console.warn(`  ! missing parent: ${parentSlug}`);
      continue;
    }
    for (const [i, child] of children.entries()) {
      // Children inherit parent flags unless `licenced: true` is set
      // (which flips both isFirearm + requiresLicence on — Barrels case).
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

  console.log('Seeding dealers…');
  for (const dealer of dealers) {
    await prisma.dealer.upsert({
      where: { licenceNumber: dealer.licenceNumber },
      create: dealer,
      update: {
        name: dealer.name,
        address: dealer.address,
        suburb: dealer.suburb,
        city: dealer.city,
        province: dealer.province,
        postalCode: dealer.postalCode,
        lat: dealer.lat,
        lng: dealer.lng,
        phone: dealer.phone,
        email: dealer.email,
      },
    });
    console.log(`  ✓ ${dealer.name}`);
  }

  console.log('Seeding superadmin…');
  const hash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD ?? 'Admin@GunGalore1!', 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@gungalore.co.za' },
    update: {},
    create: {
      email: 'admin@gungalore.co.za',
      passwordHash: hash,
      role: 'SUPERADMIN',
      firstName: 'Super',
      lastName: 'Admin',
    },
  });
  console.log('  ✓ admin@gungalore.co.za (SUPERADMIN)');

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
