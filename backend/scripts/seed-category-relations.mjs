// Seed / refresh the cross-sell ("you might also need…") relationships +
// the per-category eligibility gate. Resolves categories by NAME (unique
// within the canonical tree) so it doesn't depend on slug derivation.
//
// Idempotent — safe to re-run. Run locally (dev DB):
//   cd backend && node scripts/seed-category-relations.mjs
// On production:
//   ssh gungalore "cd ~/app/backend && node scripts/seed-category-relations.mjs"

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

// Categories whose listings must NEVER appear as a cross-sell suggestion.
// Ammo is live ammunition (powder/primers/loaded rounds) — prohibited P2P.
const INELIGIBLE_NAMES = ['Ammo'];

// Directional complements: [fromName, toName, requireExactMatch].
// requireExactMatch=true → narrow by calibre (reloading: a .308 die ≠ 9mm).
// false → soft pairing (rod → line). Names match scripts/seed-categories.mjs.
const RELATIONS = [
  // ── Reloading (calibre-matched) ──
  ['Rifle Brass Cases', 'Rifle Bullets', true],
  ['Rifle Brass Cases', 'Reloading Dies', true],
  ['Rifle Bullets', 'Rifle Brass Cases', true],
  ['Rifle Bullets', 'Reloading Dies', true],
  ['Handgun Brass Cases', 'Handgun Bullets', true],
  ['Handgun Brass Cases', 'Reloading Dies', true],
  ['Handgun Bullets', 'Handgun Brass Cases', true],
  ['Handgun Bullets', 'Reloading Dies', true],
  ['Reloading Dies', 'Rifle Bullets', true],
  ['Reloading Dies', 'Rifle Brass Cases', true],
  // ── Reloading equipment (soft) ──
  ['Reloading Dies', 'Reloading Presses', false],
  ['Reloading Presses', 'Reloading Dies', false],
  ['Reloading Presses', 'Reloading Scales', false],
  ['Reloading Kits', 'Reloading Dies', false],
  // ── Firearms → optics / accessories (soft) + components (calibre) ──
  ['Centerfire Rifles', 'Rifle Scopes', false],
  ['Centerfire Rifles', 'Scope Mounts', false],
  ['Centerfire Rifles', 'Cleaning Kits', false],
  ['Centerfire Rifles', 'Rifle Bags', false],
  ['Centerfire Rifles', 'Rifle Brass Cases', true],
  ['Centerfire Rifles', 'Rifle Bullets', true],
  ['Rimfire Rifles', 'Rifle Scopes', false],
  ['Rimfire Rifles', 'Cleaning Kits', false],
  ['Pistols', 'Holster', false],
  ['Pistols', 'Cleaning Kits', false],
  ['Pistols', 'Pistol Magazines', false],
  // ── Optics (soft) ──
  ['Rifle Scopes', 'Scope Mounts', false],
  ['Rifle Scopes', 'Rifle Bags', false],
  ['Scope Mounts', 'Rifle Scopes', false],
  // ── Fishing (soft) ──
  ['Rods', 'Reels', false],
  ['Rods', 'Lines', false],
  ['Rods', 'Terminal Tackle', false],
  ['Rods', 'Lures', false],
  ['Reels', 'Rods', false],
  ['Reels', 'Lines', false],
  ['Lures', 'Terminal Tackle', false],
  ['Lures', 'Rods', false],
  ['Lines', 'Reels', false],
  ['Lines', 'Terminal Tackle', false],
  // ── Camping & outdoor (soft) ──
  ['Sleeping Bags, Mattresses & Stretchers', 'Camping Furniture', false],
  ['Sleeping Bags, Mattresses & Stretchers', 'Lights', false],
  ['Camping Furniture', 'Sleeping Bags, Mattresses & Stretchers', false],
  ['Lights', 'Camping & Outdoor Accessories', false],
  ['Outdoor Gear', 'Lights', false],
  // ── Knives (soft) ──
  ['Hunting Knives', 'Knife Sharpeners & Sundries', false],
  ['Hunting Knives', 'Knife & Multitool Pouches', false],
  ['Tactical Knives', 'Knife Sharpeners & Sundries', false],
  ['Pocket Knives', 'Knife Sharpeners & Sundries', false],
];

async function main() {
  const cats = await prisma.category.findMany({
    select: { id: true, name: true },
  });
  // name → id (warn on dupes so we notice taxonomy drift).
  const byName = new Map();
  for (const c of cats) {
    if (byName.has(c.name)) {
      console.warn(`  ! duplicate category name "${c.name}" — using first match`);
      continue;
    }
    byName.set(c.name, c.id);
  }

  // 1. Eligibility gate. Default everything eligible, then block the
  //    prohibited set. (Re-asserts on every run.)
  await prisma.category.updateMany({ data: { crossSellEligible: true } });
  for (const name of INELIGIBLE_NAMES) {
    const id = byName.get(name);
    if (!id) {
      console.warn(`  ! ineligible category not found: ${name}`);
      continue;
    }
    await prisma.category.update({
      where: { id },
      data: { crossSellEligible: false },
    });
    console.log(`  ✓ blocked from cross-sell: ${name}`);
  }

  // 2. Relationships. sortOrder counts up per "from" category.
  const sortCounters = new Map();
  let upserted = 0;
  let skipped = 0;
  for (const [fromName, toName, requireExactMatch] of RELATIONS) {
    const fromId = byName.get(fromName);
    const toId = byName.get(toName);
    if (!fromId || !toId) {
      console.warn(
        `  ! skip relation ${fromName} → ${toName} (missing ${!fromId ? fromName : toName})`,
      );
      skipped++;
      continue;
    }
    const sortOrder = sortCounters.get(fromId) ?? 0;
    sortCounters.set(fromId, sortOrder + 1);
    await prisma.categoryRelation.upsert({
      where: {
        fromCategoryId_toCategoryId: {
          fromCategoryId: fromId,
          toCategoryId: toId,
        },
      },
      create: {
        fromCategoryId: fromId,
        toCategoryId: toId,
        sortOrder,
        requireExactMatch,
      },
      update: { sortOrder, requireExactMatch },
    });
    upserted++;
  }
  console.log(`\nDone. ${upserted} relations upserted, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
