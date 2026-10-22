/**
 * Emit the category-tree migration from prisma/category-tree.ts.
 *
 * WHY A GENERATOR: production is changed by `prisma migrate deploy`, not by the
 * seed (the seed also re-creates test dealers and the seeded superadmin, which
 * must never run on the live box). Keeping the tree in one TS module and
 * generating the SQL from it is the only way the two stay identical.
 *
 * Run:  npx ts-node --transpile-only scripts/generate-category-migration.ts
 *
 * It writes prisma/migrations/<stamp>_expand_category_tree/migration.sql.
 * Re-running overwrites that file — review the diff before committing.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  categories,
  subCategories,
  slugify,
  assertNoWeaponWordInPublic,
  RETIRED_SLUGS,
  RETIRED_REHOME,
} from '../prisma/category-tree';

const STAMP = '20261022130000';
const OUT_DIR = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  `${STAMP}_expand_category_tree`,
);
const OUT_FILE = join(OUT_DIR, 'migration.sql');

function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function bool(value: boolean | undefined): string {
  return value ? 'true' : 'false';
}

function idExpr(slug: string): string {
  return `'c' || substr(md5(random()::text || clock_timestamp()::text || ${q(slug)}), 1, 24)`;
}

const lines: string[] = [];

lines.push(
  '-- Expand the canonical category tree (operator request 2026-10-22).',
  '--',
  '-- Generated from backend/prisma/category-tree.ts by',
  '-- scripts/generate-category-migration.ts. DO NOT hand-edit this file:',
  '-- change the TS tree and re-run the generator, or the seed and production',
  '-- will drift apart.',
  '--',
  '-- WHAT THIS DOES',
  '--   1. Rewrites the 18 roots so their flags match the post-Meta-gating',
  '--      state: only camping-outdoor, fishing, overlanding and',
  '--      outdoor-clothing-footwear are publicVisible.',
  '--   2. Upserts every sub-category (existing rows keep their id; renames keep',
  '--      their slug so bookmarks, listings and indexed URLs survive).',
  '--   3. Re-homes any listing still filed on a retired slug, then deactivates',
  '--      that slug. Listings are never orphaned onto a hidden category.',
  '--',
  '-- Idempotent: safe to re-run against a database that already has the tree.',
  '',
  '-- 1. Roots ------------------------------------------------------------',
  '',
);

for (const cat of categories) {
  const values = [
    idExpr(cat.slug),
    q(cat.name),
    q(cat.slug),
    'NULL',
    bool(cat.isFirearm),
    bool(cat.requiresLicence),
    bool(cat.availableSecondhand ?? true),
    bool(cat.availableNewStore),
    bool(cat.collectionOnly),
    bool(cat.requiresPapers),
    bool(cat.showTestedWorkingAttestation),
    bool(cat.isActive ?? true),
    String(cat.sortOrder),
    bool(cat.publicVisible),
  ].join(', ');

  lines.push(
    `INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")`,
    `VALUES (${values})`,
    `ON CONFLICT ("slug") DO UPDATE SET`,
    `  "name" = EXCLUDED."name",`,
    `  "parentId" = NULL,`,
    `  "isFirearm" = EXCLUDED."isFirearm",`,
    `  "requiresLicence" = EXCLUDED."requiresLicence",`,
    `  "availableSecondhand" = EXCLUDED."availableSecondhand",`,
    `  "availableNewStore" = EXCLUDED."availableNewStore",`,
    `  "collectionOnly" = EXCLUDED."collectionOnly",`,
    `  "requiresPapers" = EXCLUDED."requiresPapers",`,
    `  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",`,
    `  "isActive" = EXCLUDED."isActive",`,
    `  "sortOrder" = EXCLUDED."sortOrder",`,
    `  "publicVisible" = EXCLUDED."publicVisible";`,
    '',
  );
}

lines.push('-- 2. Sub-categories ---------------------------------------------------', '');

for (const cat of categories) {
  const parentSlug = cat.slug;
  const children = subCategories[parentSlug] ?? [];
  if (children.length === 0) continue;

  lines.push(`-- ${cat.name}`);
  for (const [i, child] of children.entries()) {
    const childSlug = `${parentSlug}--${child.slug ?? slugify(child.name)}`;
    const isFirearm = child.licenced ? true : (cat.isFirearm ?? false);
    const requiresLicence = child.licenced
      ? true
      : (cat.requiresLicence ?? false);
    const publicVisible = child.membersOnly
      ? false
      : (cat.publicVisible ?? false);

    // Same guard the seed runs: refuse to emit SQL that would publish a
    // weapon-named category to signed-out visitors and crawlers.
    assertNoWeaponWordInPublic(child.name, childSlug, publicVisible);

    const values = [
      idExpr(childSlug),
      q(child.name),
      q(childSlug),
      `(SELECT "id" FROM "Category" WHERE "slug" = ${q(parentSlug)})`,
      bool(isFirearm),
      bool(requiresLicence),
      bool(cat.availableSecondhand ?? true),
      bool(cat.availableNewStore),
      bool(child.collectionOnly),
      bool(child.requiresPapers),
      bool(child.showTestedWorkingAttestation),
      'true',
      String(i + 1),
      bool(publicVisible),
    ].join(', ');

    lines.push(
      `INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")`,
      `VALUES (${values})`,
      `ON CONFLICT ("slug") DO UPDATE SET`,
      `  "name" = EXCLUDED."name",`,
      `  "parentId" = EXCLUDED."parentId",`,
      `  "isFirearm" = EXCLUDED."isFirearm",`,
      `  "requiresLicence" = EXCLUDED."requiresLicence",`,
      `  "availableSecondhand" = EXCLUDED."availableSecondhand",`,
      `  "availableNewStore" = EXCLUDED."availableNewStore",`,
      `  "collectionOnly" = EXCLUDED."collectionOnly",`,
      `  "requiresPapers" = EXCLUDED."requiresPapers",`,
      `  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",`,
      `  "isActive" = EXCLUDED."isActive",`,
      `  "sortOrder" = EXCLUDED."sortOrder",`,
      `  "publicVisible" = EXCLUDED."publicVisible";`,
      '',
    );
  }
}

lines.push(
  '-- 3. Retire obsolete slugs --------------------------------------------',
  '--',
  '-- Re-home first: a listing must never be left pointing at a hidden row.',
  '-- New categories default to publicVisible = false, so this is a one-way',
  '-- hide - a migration must never be the thing that publishes a listing.',
  '',
);

for (const slug of RETIRED_SLUGS) {
  const target = RETIRED_REHOME[slug];
  if (target) {
    lines.push(
      `UPDATE "Listing" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = ${q(target)})`,
      `WHERE "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = ${q(slug)});`,
      '',
    );
  }
  lines.push(
    `UPDATE "Category" SET "isActive" = false, "publicVisible" = false WHERE "slug" = ${q(slug)};`,
    '',
  );
}

lines.push(
  '-- One-directional listing resync for categories this migration hides.',
  'UPDATE "Listing" l',
  'SET "publicVisible" = false',
  'FROM "Category" c',
  'WHERE l."categoryId" = c."id"',
  '  AND c."publicVisible" = false',
  '  AND l."publicVisible" = true;',
  '',
);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');

const childCount = Object.values(subCategories).reduce(
  (sum, children) => sum + children.length,
  0,
);
console.log(
  `wrote ${OUT_FILE} (${categories.length} roots, ${childCount} sub-categories)`,
);
