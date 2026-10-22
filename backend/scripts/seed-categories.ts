/**
 * Seed / refresh ONLY the canonical category tree on whatever DATABASE_URL the
 * surrounding env points at.
 *
 * WHY THIS EXISTS SEPARATELY FROM prisma/seed.ts:
 *   `prisma/seed.ts` also re-seeds five TEST dealers and the seed superadmin,
 *   neither of which belongs on production. This script touches categories and
 *   nothing else, and imports the same tree module, so it can never drift from
 *   the seed or from the generated migration.
 *
 * WHAT IT DOES:
 *   1. Upserts the 18 roots with their exact flags.
 *   2. Upserts every sub-category. Existing rows keep their id; renames keep
 *      their explicit slug, so listings and indexed URLs survive.
 *   3. Re-homes listings still filed on a retired slug, then deactivates it.
 *   4. Deactivates any OTHER category the tree no longer declares (the same
 *      deactivate-all-then-reactivate rule prisma/seed.ts uses). Anything
 *      re-added to category-tree.ts is reactivated with stored values intact.
 *
 * Production normally gets this tree through `prisma migrate deploy` (see
 * scripts/generate-category-migration.ts). This script is the repair tool for
 * a database whose rows have drifted from the tree.
 *
 * Idempotent. Run: npx ts-node --transpile-only scripts/seed-categories.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  categories,
  subCategories,
  slugify,
  assertNoWeaponWordInPublic,
  RETIRED_REHOME,
  RETIRED_SLUGS,
} from '../prisma/category-tree';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  console.log('Deactivating every category first...');
  await prisma.category.updateMany({ data: { isActive: false } });

  console.log('Seeding parent categories...');
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
      showTestedWorkingAttestation:
        cat.showTestedWorkingAttestation ?? false,
      isExperience: false,
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
    console.log(`  ok ${cat.name}`);
  }

  console.log('Re-homing listings on retired slugs...');
  for (const slug of RETIRED_SLUGS) {
    const target = RETIRED_REHOME[slug];
    if (!target) continue;
    const [from, to] = await Promise.all([
      prisma.category.findUnique({ where: { slug } }),
      prisma.category.findUnique({ where: { slug: target } }),
    ]);
    if (!from || !to) continue;
    const moved = await prisma.listing.updateMany({
      where: { categoryId: from.id },
      data: { categoryId: to.id },
    });
    if (moved.count > 0) {
      console.log(`  moved ${moved.count} listing(s): ${slug} -> ${target}`);
    }
  }

  console.log('Seeding sub-categories...');
  for (const [parentSlug, children] of Object.entries(subCategories)) {
    const parent = await prisma.category.findUnique({
      where: { slug: parentSlug },
    });
    if (!parent) {
      console.warn(`  ! missing parent: ${parentSlug}`);
      continue;
    }
    for (const [i, child] of children.entries()) {
      const childSlug = `${parentSlug}--${child.slug ?? slugify(child.name)}`;
      const isFirearm = child.licenced ? true : parent.isFirearm;
      const requiresLicence = child.licenced ? true : parent.requiresLicence;
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
    console.log(`  ok ${parent.name}: ${children.length} sub-categories`);
  }

  const [active, total] = await Promise.all([
    prisma.category.count({ where: { isActive: true } }),
    prisma.category.count(),
  ]);
  console.log(`Done. ${active} active / ${total} total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
