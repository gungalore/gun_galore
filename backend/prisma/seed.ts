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
  // Collection-only (trailers / oversized / dangerous goods) → forces
  // COLLECTION shipping + funds-held-until-collected. requiresPapers →
  // NaTIS registration / roadworthy attestation (boolean only, no docs).
  collectionOnly?: boolean;
  requiresPapers?: boolean;
  showTestedWorkingAttestation?: boolean; // P5.4 (parents rarely set it)
  isActive?: boolean;
  // Visible to signed-out visitors + crawlers. OMITTED = members-only, because
  // Category.publicVisible defaults to false and this is an allowlist: a tree
  // added later stays hidden until someone opts it in. See the schema comment.
  publicVisible?: boolean;
  sortOrder: number;
}

// PUBLIC vs MEMBERS-ONLY (2026-08 repositioning).
//
// The signed-out storefront presents as a new-and-secondhand OUTDOOR store.
// Regulated and weapon-adjacent trees are members-only: firearms, gun-smithing
// parts, reloading components + equipment, air rifles/airsoft, self-defence and
// shooting accessories. They still work exactly as before once you sign in.
//
// `publicVisible: true` is opt-in per root. Anything without it is hidden —
// including anything added in future. Do not "fix" a missing flag by changing
// the default; add the flag to the root you actually meant to publish.
// Words that must never appear in a category a signed-out visitor can reach.
//
// The public/members split is enforced per-TREE, which is the right shape but
// leaves one blind spot: a weapon-named child sitting inside an innocent parent.
// Real examples this caught — Optics › Handgun Scopes, Optics › Rifle Scopes and
// Hunting › Shooting Sticks & Bipods were all public after the roots were gated,
// putting "handgun", "rifle" and "shooting" into crawlable URLs from trees that
// look, from the top, like binoculars and backpacks.
//
// So the guard runs on the RESULT rather than the intent: whatever the seed
// computes, refuse to write a public category whose own name or slug says
// weapon. A new sub-category is the likely way this regresses, and this fails
// the seed loudly instead of quietly republishing.
//
// To publish something this matches anyway, rename it to what it actually is
// (Paintball Ammo → Paintballs) — do not weaken the pattern.
const WEAPON_WORDS =
  /\b(fire ?arm|gun|rifle|handgun|pistol|shotgun|revolver|ammo|ammunition|calibre|caliber|muzzle|silencer|suppressor|magazine|holster|shooting)\b/i;

function assertNoWeaponWordInPublic(
  name: string,
  slug: string,
  publicVisible: boolean,
): void {
  if (!publicVisible) return;
  const hit = name.match(WEAPON_WORDS) ?? slug.replace(/-/g, ' ').match(WEAPON_WORDS);
  if (hit) {
    throw new Error(
      `Refusing to seed "${name}" (${slug}) as PUBLIC: the word "${hit[0]}" ` +
        `would appear in a crawlable, signed-out URL. Mark it ` +
        `\`membersOnly: true\`, or rename the category if it is genuinely not ` +
        `a weapon product.`,
    );
  }
}

const categories: ParentCat[] = [
  { name: 'Air Rifles', slug: 'air-rifles', sortOrder: 1 },
  // Live ammunition disabled entirely (isActive:false) — the platform is
  // not permitted to sell live ammo, primers or gun powder (2026-06-24).
  // isActive:false hides it everywhere AND blocks listing creation. Primers
  // and powder have no category at all, so they cannot be listed. Re-enable
  // only once proper dealer-ammo licensing is in place.
  { name: 'Ammo', slug: 'ammo', sortOrder: 2, availableSecondhand: false, availableNewStore: false, isActive: false },
  { name: 'Cleaning Equipment', slug: 'cleaning-equipment', sortOrder: 3, availableNewStore: true, publicVisible: true },
  // The Firearms parent — all sub-categories require dealer transfer.
  { name: 'Firearms', slug: 'firearms', sortOrder: 4, isFirearm: true, requiresLicence: true },
  { name: 'Gun Smithing & Parts', slug: 'gun-smithing-parts', sortOrder: 5, availableNewStore: true },
  { name: 'Optics', slug: 'optics', sortOrder: 6, availableNewStore: true, publicVisible: true },
  { name: 'Reloading Components', slug: 'reloading-components', sortOrder: 7, availableNewStore: true },
  { name: 'Shooting Accessories', slug: 'shooting-accessories', sortOrder: 8, availableNewStore: true },
  { name: 'Fishing', slug: 'fishing', sortOrder: 9, availableNewStore: true, publicVisible: true },
  { name: 'Camping & Outdoor', slug: 'camping-outdoor', sortOrder: 10, availableNewStore: true, publicVisible: true },
  { name: 'Knives', slug: 'knives', sortOrder: 11, availableNewStore: true, publicVisible: true },
  { name: 'Self Defence', slug: 'self-defence', sortOrder: 12, availableNewStore: true },
  { name: 'Paintball', slug: 'paintball', sortOrder: 13, availableNewStore: true, publicVisible: true },
  { name: 'Reloading Equipment', slug: 'reloading-equipment', sortOrder: 14, availableNewStore: true },
  // ─── Outdoor expansion (P3) — full outdoor marketplace tree ───────────
  { name: 'Overlanding & 4x4', slug: 'overlanding', sortOrder: 15, availableNewStore: true, publicVisible: true },
  { name: 'Hunting', slug: 'hunting', sortOrder: 16, availableNewStore: true, publicVisible: true },
  { name: 'Outdoor Clothing & Footwear', slug: 'outdoor-clothing-footwear', sortOrder: 17, availableNewStore: true, publicVisible: true },
  { name: 'Archery & Bowhunting', slug: 'archery-bowhunting', sortOrder: 18, availableNewStore: true, publicVisible: true },
];

// Sub-categories keyed by parent slug. Each child inherits the parent's
// isFirearm/requiresLicence/etc. flags unless explicitly overridden via
// `licenced: true` (only used for Barrels under Gun Smithing).
interface SubCat {
  name: string;
  licenced?: boolean; // Override — flips both isFirearm + requiresLicence to true
  collectionOnly?: boolean; // Override — in-person collection only (no courier)
  requiresPapers?: boolean; // Override — NaTIS registration / roadworthy attestation
  showTestedWorkingAttestation?: boolean; // P5.4 — offer the "tested & working" seller claim
  // Override — keep this child members-only even though its parent tree is
  // public. Used where one child is a weapon and its siblings are not
  // (Crossbows under Archery). One-way only: a child can be pulled OUT of the
  // public tree, never pushed into one.
  membersOnly?: boolean;
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
    // "Men's Hunting Pants & Shorts" was misfiled here (P3 fix) — its home
    // is now Outdoor Clothing & Footwear → Trousers & Shorts. Removed from
    // this list so the seed's deactivate-all-then-reactivate pass retires
    // the stray row (0 listings) instead of resurrecting it.
    { name: 'AR Accessories' },
    { name: 'AR Magazines' },
    { name: 'Pistol Magazines' },
  ],
  optics: [
    // Optics is a PUBLIC root — binoculars, spotting scopes, rangefinders,
    // trail cameras, thermal and drones are ordinary outdoor kit.
    //
    // The gun-mounted scopes are not, and the slug is the tell: a public
    // /category/optics--handgun-scopes puts the word "handgun" in a crawlable
    // URL, in the sitemap and in the visible category name. The parent tree
    // stays public and these five sit behind the wall with the rest of the
    // regulated stock.
    { name: 'Rifle Scopes', membersOnly: true },
    { name: 'Binoculars' },
    { name: 'Rangefinders' },
    { name: 'Optical Cleaning Equipment' },
    { name: 'Night Vision' },
    { name: 'Spotting Scopes' },
    { name: 'Optical Tripods & Window Mounts' },
    { name: 'Scope Mounts' },
    { name: 'Air Rifle Scopes', membersOnly: true },
    { name: 'Handgun Scopes', membersOnly: true },
    { name: 'Trail Cameras' },
    { name: 'Rimfire Rifle Scopes', membersOnly: true },
    { name: 'Rangefinder Binoculars' },
    { name: 'Rangefinding Rifle Scopes', membersOnly: true },
    { name: 'Previously Owned Optics' },
    { name: 'Optical Accessories' },
    { name: 'GPS & Comms' },
    { name: 'Thermal Imaging' },
    { name: 'Drones' },
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
    { name: 'Fish Finders & Electronics' },
    { name: 'Kayaks & Craft' },
  ],
  'camping-outdoor': [
    { name: 'Lights' },
    { name: 'Camping & Outdoor Accessories' },
    { name: 'Sleeping Bags, Mattresses & Stretchers' },
    { name: 'Camping Furniture' },
    { name: 'Kids Camping' },
    { name: 'Outdoor Gear' },
    { name: 'Tents' },
    { name: 'Stoves & Cooking' },
    { name: 'Coolers & Iceboxes' },
    { name: 'Water Filtration & Storage' },
    { name: 'Backpacks & Hiking Packs' },
    { name: 'Navigation & GPS' },
    { name: 'Hydration' },
  ],
  overlanding: [
    { name: 'Rooftop Tents' },
    { name: 'Awnings & Shade' },
    { name: 'Fridges & Freezers' },
    // Split out of the old mixed "Dual-Battery & Solar" leaf (2026-08-16).
    //
    // Operator rule: an item that CONTAINS a battery ships normally; a battery
    // in its naked form does not. That is the UN3480 (loose cells) vs UN3481
    // (contained in equipment) line, and it is a category question, not a
    // measurement — so it needs no field on the sell form at all. Splitting
    // the leaf lets `collectionOnly` carry the whole rule: pick Batteries and
    // the courier picker and parcel inputs simply never appear.
    //
    // They were one leaf before, which is why the old dangerous-goods gate had
    // to ask every seller for a Wh number ("enter 0 if not a battery") just to
    // tell a battery apart from the solar panel listed beside it.
    { name: 'Batteries', collectionOnly: true },
    { name: 'Solar & Charging' },
    { name: 'Recovery Gear' },
    { name: 'Drawer & Storage Systems' },
    { name: 'Roof Racks & Load Bars' },
    { name: 'Bull Bars, Sliders & Protection' },
    { name: 'Water Storage & Systems' },
    { name: 'Vehicle Lighting' },
    { name: 'Air Compressors & Tyre Gear' },
    // Trailers + off-road caravans can't courier — in-person collection
    // only + NaTIS registration/roadworthy attestation at handover.
    { name: 'Trailers & Off-Road Caravans', collectionOnly: true, requiresPapers: true },
    { name: 'Overlanding Accessories' },
    // Added on the live site through the admin panel and never backfilled here,
    // so a rebuild from this file silently lost seven public categories. Found
    // 2026-08-12 by diffing a freshly-seeded database against production.
    // The originals carry bare slugs because the admin panel does not apply the
    // `parent--child` convention; seeded here they get the consistent form,
    // which is safe on a clean database with nothing indexed yet.
    { name: 'Suspension & Lift Kits' },
    { name: 'Snorkels & Air Intakes' },
    { name: 'Canopies, Tonneau & Load-Bed' },
    { name: 'Tyres, Wheels & Beadlocks' },
    { name: 'Fuel & Jerry Cans' },
    { name: 'Portable Power & Inverters' },
    { name: 'Towing & Tow Bars' },
  ],
  hunting: [
    { name: 'Game Calls & Decoys' },
    { name: 'Blinds & Hides' },
    { name: 'Hunting Packs & Bags' },
    { name: 'Field Dressing & Butchery' },
    { name: 'Scent Control & Attractants' },
    // Same stock as the already-gated Shooting Accessories › Rest Bipods &
    // Shooting Sticks, and the duplicate is the only reason "shooting" appears
    // in a public URL. Gated, not renamed — a rest IS shooting kit.
    { name: 'Shooting Sticks & Bipods', membersOnly: true },
    { name: 'Hunting Accessories' },
  ],
  'outdoor-clothing-footwear': [
    { name: 'Jackets & Shells' },
    { name: 'Trousers & Shorts' },
    { name: 'Base Layers & Thermals' },
    { name: 'Hiking & Hunting Boots' },
    { name: 'Hats, Caps & Beanies' },
    { name: 'Gloves' },
    { name: 'Socks' },
    { name: 'Gaiters & Accessories' },
  ],
  'archery-bowhunting': [
    { name: 'Compound Bows' },
    { name: 'Recurve & Traditional Bows' },
    // Crossbows are classified as weapons by the major platforms even though
    // bows are not, so this one child stays members-only while the rest of
    // archery is a public outdoor category.
    { name: 'Crossbows', membersOnly: true },
    { name: 'Arrows & Bolts' },
    { name: 'Broadheads & Points' },
    { name: 'Releases & Sights' },
    { name: 'Targets' },
    { name: 'Archery Accessories' },
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
    // Was "Paintball Ammo". Paintballs are not ammunition and this category is
    // legitimately public, so it is RENAMED rather than gated — but the site
    // states flatly that it does not sell ammunition, and "ammo" in a public
    // URL is exactly the token that gets a page flagged by a scanner that never
    // reads the word in front of it. "Paintballs" is also just the right name.
    { name: 'Paintballs' },
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
      // Always false: Hunting Packages & Experiences was removed 2026-08-26.
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
      const childSlug = `${parentSlug}--${slugify(child.name)}`;
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

  // ─── Featured slots ────────────────────────────────────────────────
  //
  // The schema says slotNumber is "1-10, hard-allocated at seed" — but
  // nothing ever seeded them. The only featuredSlot.create in the repo was
  // in the offline dummy-run harness, so a real database came up with ZERO
  // slots: /featured/summary returned totalSlots 0, the homepage Featured
  // section had nothing to render, and no seller could bid for a spot
  // because there was no spot to bid on. Found on production 2026-08-15.
  //
  // Count comes from FeaturedSlotConfig.slotCount (default 10) so the two
  // cannot disagree. Idempotent: re-running the seed never disturbs a live
  // slot's status, occupant or auction — `update: {}` deliberately leaves
  // existing rows completely alone.
  //
  // New rows land VACANT with no auction. The featured-tick cron (every
  // minute) then opens an AD_HOC auction on each, at closesAt = null — the
  // countdown only starts when a seller places the first bid. That is the
  // documented cold-start path, so this seeds nothing that starts a timer
  // or charges anyone.
  const featuredCfg = await prisma.featuredSlotConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });
  for (let n = 1; n <= featuredCfg.slotCount; n++) {
    await prisma.featuredSlot.upsert({
      where: { slotNumber: n },
      update: {},
      create: { slotNumber: n, status: 'VACANT' },
    });
  }
  const slotTotal = await prisma.featuredSlot.count();
  console.log(`  ✓ ${slotTotal} featured slots (config slotCount=${featuredCfg.slotCount})`);

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
