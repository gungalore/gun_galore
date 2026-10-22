// ─── CANONICAL CATEGORY TREE ────────────────────────────────────────────
// Single source of truth for the 2-level taxonomy. Imported by
// prisma/seed.ts (which writes it to whatever database it points at) and by
// scripts/generate-category-migration.ts (which emits the SQL that ships the
// same tree through `prisma migrate deploy`).
//
// NEVER edit the tree in one place only. A change here that skips the
// generator never reaches production, because deploy runs migrations and not
// the seed (the seed also re-creates test dealers, which must not happen on
// the live box).
//
// Structure rules:
//   - `isFirearm: true` → category contains items legally classified as firearms
//   - `requiresLicence: true` → must ship via licensed-dealer transfer (SAPS rule)
//   - `availableSecondhand: false` → hidden from the used marketplace Sell form
//     (used for live ammo categories where private resale is banned)
//   - `availableNewStore: true` → appears on the dealer New Store (M3)
//
// Children inherit the parent's flags unless overridden (e.g. Barrels under
// Gun Smithing has requiresLicence=true while siblings don't).

export interface ParentCat {
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

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// PUBLIC vs MEMBERS-ONLY (2026-08 repositioning).
//
// The signed-out storefront presents as a new-and-secondhand OUTDOOR store.
// Regulated and weapon-adjacent trees are members-only: firearms, gun-smithing
// parts, reloading components + equipment, air rifles/airsoft, self-defence and
// shooting accessories. They still work exactly as before once you sign in.
//
// The 2026-08 gating migrations (20260821120000, 20260821140000,
// 20260821150000) narrowed the public shopfront further after Meta restricted
// the site: Optics, Hunting, Knives, Archery & Bowhunting, Paintball and
// Cleaning Equipment are members-only too, and the one clothing child whose
// slug carried "hunting" is gated. The flags below MATCH the database state;
// do not re-publish a root by "fixing" a missing publicVisible here.
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
export const WEAPON_WORDS =
  /\b(fire ?arm|gun|rifle|handgun|pistol|shotgun|revolver|ammo|ammunition|calibre|caliber|muzzle|silencer|suppressor|magazine|holster|shooting)\b/i;

export function assertNoWeaponWordInPublic(
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

export const categories: ParentCat[] = [
  { name: 'Air Rifles', slug: 'air-rifles', sortOrder: 1 },
  // Live ammunition disabled entirely (isActive:false) — the platform is
  // not permitted to sell live ammo, primers or gun powder (2026-06-24).
  // isActive:false hides it everywhere AND blocks listing creation. Primers
  // and powder have no category at all, so they cannot be listed. Re-enable
  // only once proper dealer-ammo licensing is in place.
  { name: 'Ammo', slug: 'ammo', sortOrder: 2, availableSecondhand: false, availableNewStore: false, isActive: false },
  // Members-only since the 2026-08 Meta gating: a gun-cleaning tree wearing a
  // neutral name.
  { name: 'Cleaning Equipment', slug: 'cleaning-equipment', sortOrder: 3, availableNewStore: true },
  // The Firearms parent — all sub-categories require dealer transfer.
  { name: 'Firearms', slug: 'firearms', sortOrder: 4, isFirearm: true, requiresLicence: true },
  { name: 'Gun Smithing & Parts', slug: 'gun-smithing-parts', sortOrder: 5, availableNewStore: true },
  { name: 'Optics', slug: 'optics', sortOrder: 6, availableNewStore: true },
  { name: 'Reloading Components', slug: 'reloading-components', sortOrder: 7, availableNewStore: true },
  { name: 'Shooting Accessories', slug: 'shooting-accessories', sortOrder: 8, availableNewStore: true },
  { name: 'Fishing', slug: 'fishing', sortOrder: 9, availableNewStore: true, publicVisible: true },
  { name: 'Camping & Outdoor', slug: 'camping-outdoor', sortOrder: 10, availableNewStore: true, publicVisible: true },
  { name: 'Knives', slug: 'knives', sortOrder: 11, availableNewStore: true },
  { name: 'Self Defence', slug: 'self-defence', sortOrder: 12, availableNewStore: true },
  { name: 'Paintball', slug: 'paintball', sortOrder: 13, availableNewStore: true },
  { name: 'Reloading Equipment', slug: 'reloading-equipment', sortOrder: 14, availableNewStore: true },
  // ─── Outdoor expansion (P3) — full outdoor marketplace tree ───────────
  { name: 'Overlanding & 4x4', slug: 'overlanding', sortOrder: 15, availableNewStore: true, publicVisible: true },
  { name: 'Hunting', slug: 'hunting', sortOrder: 16, availableNewStore: true },
  { name: 'Outdoor Clothing & Footwear', slug: 'outdoor-clothing-footwear', sortOrder: 17, availableNewStore: true, publicVisible: true },
  { name: 'Archery & Bowhunting', slug: 'archery-bowhunting', sortOrder: 18, availableNewStore: true },
];

// Sub-categories keyed by parent slug. Each child inherits the parent's
// isFirearm/requiresLicence/etc. flags unless explicitly overridden via
// `licenced: true` (only used for Barrels under Gun Smithing).
export interface SubCat {
  name: string;
  // Explicit slug override. Used when a display name is corrected but the
  // existing URL must stay stable (renaming in place keeps every listing,
  // bookmark and indexed URL pointing at the same row).
  slug?: string;
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

export const subCategories: Record<string, SubCat[]> = {
  'air-rifles': [
    { name: 'Air Pistols' },
    { name: 'Air Rifle Pellets' },
    { name: 'Air Rifle Traps & Accessories' },
    { name: 'Air Rifles Springer' },
    { name: 'Air Rifles PCP' },
    { name: 'CO2 & Gas-Ram Air Rifles' },
    { name: 'Air Rifle Slugs' },
    // High-pressure cylinders cannot travel by courier.
    { name: 'PCP Compressors, Pumps & Cylinders', collectionOnly: true, showTestedWorkingAttestation: true },
    // Slug kept as `airsoft` so the existing indexed URL survives the rename.
    { name: 'Airsoft Guns & Rifles', slug: 'airsoft' },
    { name: 'Airsoft Gear, Parts & BBs' },
  ],
  'cleaning-equipment': [
    { name: 'Solvents' },
    { name: 'Sundry Equipment' },
    // Slug kept as `jags-and-rods` — the old name is the only thing that was
    // wrong, and half its stock (pull-throughs) never was a jag.
    { name: 'Cleaning Rods & Pull-Throughs', slug: 'jags-and-rods' },
    { name: 'Jags, Mops & Brushes' },
    { name: 'Cleaning Kits' },
    { name: 'Gun Oils, Greases & Lubricants' },
    { name: 'Bore Snakes & Patches' },
    { name: 'Cleaning Mats, Vices & Cradles' },
    { name: 'Ultrasonic Cleaners', showTestedWorkingAttestation: true },
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
    { name: 'Lever-Action Rifles' },
    { name: 'Pistol-Calibre Carbines (PCC)' },
    { name: 'Single-Shot Rifles & Shotguns' },
    { name: 'Combination Guns & Drillings' },
    { name: 'Side-by-Side Shotguns' },
  ],
  'gun-smithing-parts': [
    { name: 'Actions' },
    // Barrels are licence-required per SA firearm regulations — dealer
    // transfer only, no courier. (See the Regulated Goods rules.)
    { name: 'Barrels', licenced: true },
    { name: 'Rifle Parts & Screws' },
    { name: 'Rifle Stocks' },
    { name: 'Rifle Tools' },
    { name: 'Silencers' },
    { name: 'Triggers' },
    // "Men's Hunting Pants & Shorts" was misfiled here (P3 fix) — its home
    // is now Outdoor Clothing & Footwear → Trousers & Shorts.
    { name: 'AR Accessories' },
    { name: 'AR Magazines' },
    { name: 'Pistol Magazines' },
    { name: 'Rifle Magazines' },
    { name: 'Chassis Systems' },
    { name: 'Muzzle Brakes & Compensators' },
    { name: 'Handgun Parts, Sights & Grips' },
    { name: 'Shotgun Chokes & Parts' },
    { name: 'Gunsmithing Supplies, Finishes & Coatings' },
  ],
  optics: [
    // Optics is a MEMBERS-ONLY root since the 2026-08 Meta gating, even though
    // binoculars and trail cameras are ordinary outdoor kit. See the gating
    // migrations before re-publishing any of it.
    { name: 'Rifle Scopes', membersOnly: true },
    { name: 'Binoculars' },
    { name: 'Rangefinders', showTestedWorkingAttestation: true },
    { name: 'Optical Cleaning Equipment' },
    { name: 'Night Vision', showTestedWorkingAttestation: true },
    { name: 'Spotting Scopes' },
    { name: 'Optical Tripods & Window Mounts' },
    // Slug kept as `scope-mounts`; the display name now says what it holds.
    { name: 'Scope Mounts, Rings & Rails', slug: 'scope-mounts' },
    { name: 'Air Rifle Scopes', membersOnly: true },
    { name: 'Handgun Scopes', membersOnly: true },
    { name: 'Trail Cameras', showTestedWorkingAttestation: true },
    { name: 'Rimfire Rifle Scopes', membersOnly: true },
    { name: 'Rangefinder Binoculars' },
    { name: 'Rangefinding Rifle Scopes', membersOnly: true },
    { name: 'Optical Accessories' },
    { name: 'GPS & Comms', showTestedWorkingAttestation: true },
    { name: 'Thermal Imaging', showTestedWorkingAttestation: true },
    { name: 'Drones', showTestedWorkingAttestation: true },
    { name: 'Red Dots, Reflex & Holographic Sights', showTestedWorkingAttestation: true },
    { name: 'Magnifiers & Prism Scopes' },
    { name: 'Lens Covers, Sunshades & Throw Levers' },
  ],
  'reloading-components': [
    { name: 'Rifle Bullets' },
    { name: 'Rifle Brass Cases' },
    { name: 'Handgun Bullets' },
    { name: 'Handgun Brass Cases' },
    // Inert hulls, wads and shot only — never live primers or propellant.
    { name: 'Shotgun Hulls, Wads & Shot' },
  ],
  'reloading-equipment': [
    { name: 'Reloading Dies' },
    { name: 'Reloading Scales', showTestedWorkingAttestation: true },
    { name: 'Measures' },
    { name: 'Reloading Presses' },
    { name: 'Reloading Kits' },
    { name: 'Reloading Sundry Equipment' },
    { name: 'Case Trimmers, Prep & Annealing', showTestedWorkingAttestation: true },
    { name: 'Case Tumblers & Cleaners', showTestedWorkingAttestation: true },
    { name: 'Priming Tools' },
    { name: 'Calipers, Micrometers & Gauges' },
    { name: 'Reloading Manuals & Data' },
  ],
  'shooting-accessories': [
    { name: 'Ammo Boxes & Storage Cases' },
    { name: 'Ballistic Software' },
    { name: 'Bore Sighters' },
    { name: 'Calling Equipment' },
    { name: 'Chronographs', showTestedWorkingAttestation: true },
    // Slugs kept from the old one-word labels; only the display text changed.
    { name: 'Hearing & Eye Protection', slug: 'protection' },
    { name: 'Holsters & Mag Carriers', slug: 'holster' },
    { name: 'Rest Bipods & Shooting Sticks' },
    { name: 'Rest X-Bags & Rear Bags' },
    { name: 'Rifle Bags' },
    { name: 'Rifle Safes' },
    { name: 'Rifle Slings & Straps' },
    { name: 'Targets & Stands' },
    { name: 'Windmeters', showTestedWorkingAttestation: true },
    { name: 'Weapons Mounted Lights', showTestedWorkingAttestation: true },
    { name: 'Ammo Pouches & Bandoliers', slug: 'ammo-pouch' },
    { name: 'Hard Cases & Range Bags' },
    { name: 'Handgun Safes & Vaults' },
    { name: 'Shooting Mats' },
    { name: 'Steel Targets & Gongs' },
    { name: 'Shot Timers & Training Aids', showTestedWorkingAttestation: true },
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
    { name: 'Fish Finders & Electronics', showTestedWorkingAttestation: true },
    { name: 'Kayaks & Craft', collectionOnly: true },
    { name: 'Rod & Reel Combos' },
    { name: 'Fly Fishing Gear & Fly Tying' },
    { name: 'Tackle Boxes, Bags & Rod Holdalls' },
    { name: 'Rod Holders, Banksticks & Bite Alarms', showTestedWorkingAttestation: true },
    { name: 'Landing Nets, Gaffs & Weigh Scales' },
    { name: 'Trolling Motors & Marine Batteries', collectionOnly: true, showTestedWorkingAttestation: true },
    { name: 'Bait Boats', showTestedWorkingAttestation: true },
    { name: 'Inflatables & Float Tubes' },
  ],
  'camping-outdoor': [
    { name: 'Lights', showTestedWorkingAttestation: true },
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
    { name: 'Navigation & GPS', showTestedWorkingAttestation: true },
    { name: 'Hydration' },
    { name: 'Gazebos, Tarps & Shade' },
    { name: 'Braai, Potjie & Cast Iron' },
    { name: 'Camp Showers, Toilets & Enclosures' },
    { name: 'Solar Blankets & Portable Power', showTestedWorkingAttestation: true },
    { name: 'Trekking Poles & Hiking Gear' },
  ],
  overlanding: [
    { name: 'Rooftop Tents' },
    { name: 'Awnings & Shade' },
    { name: 'Fridges & Freezers', showTestedWorkingAttestation: true },
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
    { name: 'Solar & Charging', showTestedWorkingAttestation: true },
    { name: 'Recovery Gear' },
    { name: 'Drawer & Storage Systems' },
    { name: 'Roof Racks & Load Bars' },
    { name: 'Bull Bars, Sliders & Protection' },
    { name: 'Water Storage & Systems' },
    { name: 'Vehicle Lighting', showTestedWorkingAttestation: true },
    { name: 'Air Compressors & Tyre Gear', showTestedWorkingAttestation: true },
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
    { name: 'Portable Power & Inverters', showTestedWorkingAttestation: true },
    { name: 'Towing & Tow Bars' },
    { name: 'Winches & Winch Accessories', showTestedWorkingAttestation: true },
    { name: 'Two-Way Radios & Vehicle Comms', showTestedWorkingAttestation: true },
    { name: 'Camp Kitchens & Drop-Down Tables' },
    { name: 'Long-Range Fuel & Water Tanks' },
    { name: 'Seat Covers, Mats & Interior Organisers' },
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
    { name: 'Ghillie Suits & Camo Concealment' },
    { name: 'Meat Processing, Mincers & Biltong Dryers', showTestedWorkingAttestation: true },
    { name: 'Dog Tracking, Collars & Field Gear', showTestedWorkingAttestation: true },
    { name: 'Trophy Mounts, Shields & Skull Kits' },
  ],
  'outdoor-clothing-footwear': [
    { name: 'Jackets & Shells' },
    { name: 'Trousers & Shorts' },
    { name: 'Base Layers & Thermals' },
    // Gated since 2026-08-21 (migration 20260821150000): the SLUG carries
    // "hunting", and a slug is a crawlable URL. Do not re-publish.
    { name: 'Hiking & Hunting Boots', membersOnly: true },
    { name: 'Hats, Caps & Beanies' },
    { name: 'Gloves' },
    { name: 'Socks' },
    { name: 'Gaiters & Accessories' },
    { name: 'Fleece, Hoodies & Mid-Layers' },
    { name: 'Shirts, Bush Shirts & Polos' },
    { name: 'Rainwear & Ponchos' },
    // The public-safe home for boots and trail shoes while the historical
    // "hiking-and-hunting-boots" slug stays gated.
    { name: 'Hiking & Trail Footwear' },
    { name: 'Sandals & Camp Footwear' },
    { name: 'Belts, Braces & Sunglasses' },
    { name: 'Wetsuits & Watersports Apparel' },
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
    { name: 'Quivers, Rests & Stabilisers' },
    { name: 'Bow Cases & Bags' },
    { name: 'Bowstrings, Cables & Presses' },
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
    // Slug kept as `accessories-knives`; the old name said nothing.
    { name: 'Knife Parts, Clips & Scales', slug: 'accessories-knives' },
    { name: 'Everyday Carry (EDC) & Folding Knives' },
    { name: 'Skinning & Caping Knives' },
    { name: 'Machetes, Pangas & Bushcraft' },
    { name: 'Knife Making Supplies & Blanks' },
  ],
  'self-defence': [
    { name: 'Pepper Sprays' },
    { name: 'Launchers' },
    { name: 'Body Armour & Plate Carriers' },
    { name: 'Stun Guns & Batons' },
    { name: 'Projectiles and Accessories' },
    { name: 'Tactical Belts, Pouches & Chest Rigs' },
    { name: 'Tactical Torches & EDC Lights', showTestedWorkingAttestation: true },
    { name: 'First Aid, IFAK & Trauma Kits' },
    { name: 'Home Security, Alarms & Beams', showTestedWorkingAttestation: true },
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
    // Compressed-gas cylinders: collection only, never couriered.
    { name: 'HPA & CO2 Tanks & Regulators', collectionOnly: true },
    { name: 'Pods, Harnesses & Vests' },
    { name: 'Paintball Jerseys, Pants & Pads' },
  ],
  // Ammo has no sub-categories — it's a single-pill parent under New Store.
  ammo: [],
};

// Slugs that used to exist and must not be resurrected. The seed's
// deactivate-all pass retires anything absent from the tree; the migration
// generator emits an explicit deactivation for these so the live box follows
// the same rule without running the seed (which also re-creates test dealers).
export const RETIRED_SLUGS = [
  'optics--previously-owned-optics',
  'gun-smithing-parts--men-s-hunting-pants-and-shorts',
  'paintball--paintball-ammo',
];

// Where any listing still filed on a retired slug belongs. Re-homed before the
// old row is deactivated so no listing is left pointing at a hidden category.
export const RETIRED_REHOME: Record<string, string> = {
  'optics--previously-owned-optics': 'optics--optical-accessories',
  'gun-smithing-parts--men-s-hunting-pants-and-shorts':
    'outdoor-clothing-footwear--trousers-and-shorts',
  'paintball--paintball-ammo': 'paintball--paintballs',
};
