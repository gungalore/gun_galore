/**
 * Split the mixed "Dual-Battery & Solar" leaf, and retire the per-category
 * attribute inputs. Idempotent — safe to re-run.
 *
 * WHY (operator, 2026-08-16): an item that CONTAINS a battery ships normally;
 * a battery in its naked form does not. That is the UN3480 / UN3481 line, and
 * it is a category question rather than a measurement — so it needs no field
 * on the sell form. One leaf held both bare batteries AND solar panels, DC-DC
 * chargers and wiring, which is the only reason the old dangerous-goods gate
 * had to ask every seller for a Wh number ("enter 0 if not a battery") just to
 * tell them apart. Split the leaf and `collectionOnly` carries the whole rule.
 *
 * The existing row is KEPT and becomes "Solar & Charging" — the shippable
 * majority — so its id, cross-sell complements and any other FK references
 * survive. "Batteries" is created fresh and marked collectionOnly, which the
 * sell form already honours (it hides the courier picker and the parcel
 * weight/dimension inputs, exactly as Trailers & Off-Road Caravans does today).
 *
 * Attributes are DEACTIVATED, never deleted: nothing is destroyed, and any
 * category's fields can be brought back with its stored values intact. Both
 * getEffectiveAttributes and the Meili facet derivation filter on isActive, so
 * this one flag switches specs off consistently across the sell form, the edit
 * form, browse filters, facets and the PDP specifications card.
 *
 * Run:  npx tsx scripts/split-battery-category.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const OLD_SLUG = 'overlanding--dual-battery-and-solar';
const SOLAR_SLUG = 'overlanding--solar-and-charging';
const BATTERY_SLUG = 'overlanding--batteries';

async function main() {
  const parent = await prisma.category.findUnique({
    where: { slug: 'overlanding' },
  });
  if (!parent) throw new Error('missing parent category: overlanding');

  // ── 1. Repurpose the existing leaf as Solar & Charging ────────────────
  const existing = await prisma.category.findUnique({
    where: { slug: OLD_SLUG },
  });

  if (existing) {
    // Make room: everything sorted after the old leaf shifts down one, so the
    // new Batteries leaf can sit beside its sibling instead of at the end.
    await prisma.category.updateMany({
      where: {
        parentId: parent.id,
        sortOrder: { gt: existing.sortOrder },
      },
      data: { sortOrder: { increment: 1 } },
    });

    await prisma.category.update({
      where: { id: existing.id },
      data: {
        name: 'Solar & Charging',
        slug: SOLAR_SLUG,
        collectionOnly: false,
        sortOrder: existing.sortOrder + 1,
        showTestedWorkingAttestation: true,
        isActive: true,
      },
    });
    console.log(`✓ ${OLD_SLUG} → ${SOLAR_SLUG} (id preserved: ${existing.id})`);
  } else {
    console.log(`· ${OLD_SLUG} not present — already split`);
  }

  // ── 2. Create the Batteries leaf ──────────────────────────────────────
  const solar = await prisma.category.findUnique({ where: { slug: SOLAR_SLUG } });
  if (!solar) throw new Error(`expected ${SOLAR_SLUG} to exist by now`);

  const batteryData = {
    name: 'Batteries',
    slug: BATTERY_SLUG,
    parentId: parent.id,
    // Inherit from the parent exactly as the seed's sub-category loop does.
    isFirearm: parent.isFirearm,
    requiresLicence: parent.requiresLicence,
    publicVisible: parent.publicVisible,
    availableSecondhand: parent.availableSecondhand,
    availableNewStore: parent.availableNewStore,
    // THE POINT OF THIS SCRIPT. A bare battery is never couriered, so the sell
    // form must not offer the service — collectionOnly already does that.
    collectionOnly: true,
    requiresPapers: false,
    showTestedWorkingAttestation: true,
    sortOrder: Math.max(1, solar.sortOrder - 1),
    isActive: true,
  };

  await prisma.category.upsert({
    where: { slug: BATTERY_SLUG },
    create: batteryData,
    update: batteryData,
  });
  console.log(`✓ ${BATTERY_SLUG} (collectionOnly — no courier offered)`);

  // ── 3. Retire every per-category attribute input ──────────────────────
  const before = await prisma.categoryAttribute.count({
    where: { isActive: true },
  });
  const { count } = await prisma.categoryAttribute.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });
  console.log(`✓ deactivated ${count} of ${before} attribute definitions`);

  // Safety net: this only stays safe while no listing has stored values,
  // because validateAndCleanAttributes drops keys with no definition and the
  // update path REPLACES the attributes column wholesale. Report rather than
  // assume.
  const withAttrs = await prisma.listing.count({
    where: { NOT: { attributes: { equals: Prisma.DbNull } } },
  });
  if (withAttrs > 0) {
    console.warn(
      `  ! ${withAttrs} listing(s) still hold stored attribute values. They ` +
        `are not deleted, but they will no longer render and would be dropped ` +
        `if that listing is edited. Review before this reaches a stocked site.`,
    );
  } else {
    console.log('  · no listing holds stored attribute values — nothing at risk');
  }

  // ── 4. Report ─────────────────────────────────────────────────────────
  const collectionOnly = await prisma.category.findMany({
    where: { collectionOnly: true, isActive: true },
    select: { slug: true, name: true },
    orderBy: { slug: 'asc' },
  });
  console.log('\nCollection-only categories (no courier offered):');
  for (const c of collectionOnly) console.log(`  · ${c.name} (${c.slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
