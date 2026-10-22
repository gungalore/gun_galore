import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import {
  categories,
  subCategories,
  slugify,
  assertNoWeaponWordInPublic,
} from './category-tree';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

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

// ─── P4 — PER-CATEGORY ATTRIBUTE DEFINITIONS ────────────────────────────
// Keyed by category slug → flagship attribute set. Kept IDENTICAL to the
// 20260702170000_p4_attributes migration (this is the canonical source;
// the migration is its hand-applied twin). A listing inherits its (leaf)
// category's attributes PLUS all ancestor categories' attributes, deduped
// by key with the nearest category winning — resolved at read time by
// CategoriesService.getEffectiveAttributes, not stored per-child. So the
// Outdoor Clothing & Footwear set lives on the ROOT only.
//
// Rules baked into every row below: required = false; filterable = true
// EXCEPT gear_ratio (free-text, not a facet); sortOrder = array order.
type AttrType = 'NUMBER' | 'SELECT' | 'TEXT' | 'BOOLEAN';
interface AttrDef {
  key: string;
  label: string;
  type: AttrType;
  unit?: string;
  options?: string[];
  filterable?: boolean; // default true
  required?: boolean; // default false
}

// ─── P4 — per-category attribute definitions ───────────────────────────
//
// DELIBERATELY EMPTY since 2026-08-16, on the operator's instruction: the sell
// form is simple for every item, and the only extra questions belong to the
// restricted goods (firearms and barrels), whose serial / licence / dealer-stock
// fields are hard-coded form sections and were never part of this system.
//
// What used to live here: 46 rows across 13 categories — capacity_litres,
// fridge_type, rod_class, reel_size, draw_weight_lbs, the five-field vehicle
// FITMENT set, and battery_wh. All of them made a seller answer spec questions
// to list a second-hand fridge.
//
// The rows are NOT deleted. `main()` deactivates them (isActive:false) and this
// map reactivates anything still listed — the same deactivate-then-reseed
// pattern the category tree uses above. Both `getEffectiveAttributes`
// (categories.service.ts) and the Meili facet derivation
// (search.service.ts filterableAttrFacets) filter on isActive, so one flag
// switches specs off consistently everywhere: sell form, edit form, browse
// filters, facets and the PDP specifications card. Re-adding an entry here
// brings that category's fields back with its stored values intact.
//
// NOTE ON battery_wh: it is gone for good, not merely parked. It existed only
// to tell a battery apart from the solar panel in the same category so the
// dangerous-goods gate could force collection. That is now the Batteries /
// Solar & Charging category split, so the question has no job left.
//
// If specs ever come back, add them per category and NEVER filter individual
// keys out of a category that still has others: validateAndCleanAttributes
// drops stored keys with no definition and listings.service REPLACES the whole
// attributes column, so a seller editing their price would silently erase the
// orphaned values. All-or-nothing per category is the safe shape.
const categoryAttributes: Record<string, AttrDef[]> = {};

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
      collectionOnly: cat.collectionOnly ?? false,
      requiresPapers: cat.requiresPapers ?? false,
      showTestedWorkingAttestation: cat.showTestedWorkingAttestation ?? false,
      // Always false: the on-site-services category was retired.
      // Written explicitly rather than omitted for the same reason the note
      // below gives for publicVisible — an upsert that omits a column does not
      // leave it alone, and this one must not resurrect a stale true.
      isExperience: false,
      // MUST be written explicitly. Omitting it does not "leave it alone" — the
      // column defaults to false, so an upsert without it silently demotes every
      // public root and the signed-out shop goes empty. Children then read
      // parent.publicVisible back from the DB and inherit the same false.
      publicVisible: cat.publicVisible ?? false,
      sortOrder: cat.sortOrder,
      isActive: cat.isActive ?? true,
      parentId: null,
    };
    assertNoWeaponWordInPublic(data.name, data.slug, data.publicVisible);
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
      const childSlug = `${parentSlug}--${child.slug ?? slugify(child.name)}`;
      const isFirearm = child.licenced ? true : parent.isFirearm;
      const requiresLicence = child.licenced ? true : parent.requiresLicence;
      // Public visibility inherits DOWN only, and `membersOnly` can pull a
      // single child back out. A child under a members-only parent can never
      // become public by accident.
      const publicVisible = child.membersOnly ? false : parent.publicVisible;
      assertNoWeaponWordInPublic(child.name, childSlug, publicVisible);
      const data = {
        name: child.name,
        slug: childSlug,
        parentId: parent.id,
        isFirearm,
        requiresLicence,
        publicVisible,
        availableSecondhand: parent.availableSecondhand,
        availableNewStore: parent.availableNewStore,
        collectionOnly: child.collectionOnly ?? false,
        requiresPapers: child.requiresPapers ?? false,
        showTestedWorkingAttestation:
          child.showTestedWorkingAttestation ?? false,
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

  // P5.4 — flag powered-electronics / appliance leaves so the sell form offers
  // the optional "tested & working" seller-attestation checkbox. Kept in EXACT
  // lockstep with migration 20260702220000_p5_3_p5_4 (same slug list). Runs
  // AFTER the sub-category loop (which defaults the flag to false).
  console.log('Flagging tested-&-working categories…');
  await prisma.category.updateMany({
    where: {
      slug: {
        in: [
          'overlanding--fridges-and-freezers',
          // Both halves of the old dual-battery-and-solar leaf: a battery and
          // a solar controller are equally worth a "tested & working" claim.
          'overlanding--batteries',
          'overlanding--solar-and-charging',
          'overlanding--vehicle-lighting',
          'camping-outdoor--lights',
          'camping-outdoor--navigation-and-gps',
          'fishing--fish-finders-and-electronics',
          'optics--drones',
          'optics--gps-and-comms',
          'optics--thermal-imaging',
          'optics--trail-cameras',
          'shooting-accessories--weapons-mounted-lights',
        ],
      },
    },
    data: { showTestedWorkingAttestation: true },
  });

  // ─── P4 — per-category attribute definitions ───────────────────────────
  // Upsert each flagship attribute on its category by the (categoryId, key)
  // unique. Produces the identical rows to the 20260702170000 migration.
  // Mirror of the category deactivation at the top of main(): clear the flag
  // on every row first, then let the map below reactivate whatever is still
  // declared. Without this, emptying the map would leave the old rows live —
  // upsert only touches keys it is given.
  console.log('Deactivating stale category attributes…');
  await prisma.categoryAttribute.updateMany({ data: { isActive: false } });

  console.log('Seeding category attributes…');
  for (const [slug, attrs] of Object.entries(categoryAttributes)) {
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      console.warn(`  ! missing category for attributes: ${slug}`);
      continue;
    }
    for (const [i, attr] of attrs.entries()) {
      const data = {
        label: attr.label,
        type: attr.type,
        unit: attr.unit ?? null,
        options: attr.options ?? [],
        required: attr.required ?? false,
        filterable: attr.filterable ?? true,
        sortOrder: i + 1,
        isActive: true,
      };
      await prisma.categoryAttribute.upsert({
        where: { categoryId_key: { categoryId: category.id, key: attr.key } },
        create: { categoryId: category.id, key: attr.key, ...data },
        update: data,
      });
    }
    console.log(`  ✓ ${category.name}: ${attrs.length} attributes`);
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

  // ── Superadmin ───────────────────────────────────────────────────────────
  //
  // This used to fall back to a hard-coded password when ADMIN_SEED_PASSWORD was
  // unset. That default is in this file, in git history, and in every clone —
  // so seeding a production box silently created a SUPERADMIN whose password
  // anyone with repo access already knew. Now it refuses.
  //
  // Local development keeps a convenience default, because a dev box behind
  // localhost with throwaway data is not the same risk and forcing a ceremony
  // there just gets worked around.
  console.log('Seeding superadmin…');
  const seedPassword = process.env.ADMIN_SEED_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !seedPassword) {
    throw new Error(
      'ADMIN_SEED_PASSWORD is required when NODE_ENV=production.\n' +
        'Refusing to create a SUPERADMIN with a default password — the old default was\n' +
        'committed to this repository and is not a secret. Generate one and pass it in:\n' +
        '  ADMIN_SEED_PASSWORD="$(openssl rand -base64 24)" npx prisma db seed',
    );
  }
  const adminEmail =
    process.env.ADMIN_SEED_EMAIL ?? 'admin@alloutdoor.co.za';
  const hash = await bcrypt.hash(seedPassword ?? 'dev-only-not-for-production', 10);
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: hash,
      role: 'SUPERADMIN',
      firstName: 'Super',
      lastName: 'Admin',
    },
  });
  console.log(`  ✓ ${adminEmail} (SUPERADMIN)`);

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
