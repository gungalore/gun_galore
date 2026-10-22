-- Expand the canonical category tree (operator request 2026-10-22).
--
-- Generated from backend/prisma/category-tree.ts by
-- scripts/generate-category-migration.ts. DO NOT hand-edit this file:
-- change the TS tree and re-run the generator, or the seed and production
-- will drift apart.
--
-- WHAT THIS DOES
--   1. Rewrites the 18 roots so their flags match the post-Meta-gating
--      state: only camping-outdoor, fishing, overlanding and
--      outdoor-clothing-footwear are publicVisible.
--   2. Upserts every sub-category (existing rows keep their id; renames keep
--      their slug so bookmarks, listings and indexed URLs survive).
--   3. Re-homes any listing still filed on a retired slug, then deactivates
--      that slug. Listings are never orphaned onto a hidden category.
--
-- Idempotent: safe to re-run against a database that already has the tree.

-- 1. Roots ------------------------------------------------------------

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles'), 1, 24), 'Air Rifles', 'air-rifles', NULL, false, false, true, false, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'ammo'), 1, 24), 'Ammo', 'ammo', NULL, false, false, false, false, false, false, false, false, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment'), 1, 24), 'Cleaning Equipment', 'cleaning-equipment', NULL, false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms'), 1, 24), 'Firearms', 'firearms', NULL, true, true, true, false, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts'), 1, 24), 'Gun Smithing & Parts', 'gun-smithing-parts', NULL, false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics'), 1, 24), 'Optics', 'optics', NULL, false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components'), 1, 24), 'Reloading Components', 'reloading-components', NULL, false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories'), 1, 24), 'Shooting Accessories', 'shooting-accessories', NULL, false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing'), 1, 24), 'Fishing', 'fishing', NULL, false, false, true, true, false, false, false, true, 9, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor'), 1, 24), 'Camping & Outdoor', 'camping-outdoor', NULL, false, false, true, true, false, false, false, true, 10, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives'), 1, 24), 'Knives', 'knives', NULL, false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence'), 1, 24), 'Self Defence', 'self-defence', NULL, false, false, true, true, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball'), 1, 24), 'Paintball', 'paintball', NULL, false, false, true, true, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment'), 1, 24), 'Reloading Equipment', 'reloading-equipment', NULL, false, false, true, true, false, false, false, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding'), 1, 24), 'Overlanding & 4x4', 'overlanding', NULL, false, false, true, true, false, false, false, true, 15, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting'), 1, 24), 'Hunting', 'hunting', NULL, false, false, true, true, false, false, false, true, 16, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear'), 1, 24), 'Outdoor Clothing & Footwear', 'outdoor-clothing-footwear', NULL, false, false, true, true, false, false, false, true, 17, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting'), 1, 24), 'Archery & Bowhunting', 'archery-bowhunting', NULL, false, false, true, true, false, false, false, true, 18, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = NULL,
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- 2. Sub-categories ---------------------------------------------------

-- Air Rifles
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-pistols'), 1, 24), 'Air Pistols', 'air-rifles--air-pistols', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-rifle-pellets'), 1, 24), 'Air Rifle Pellets', 'air-rifles--air-rifle-pellets', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-rifle-traps-and-accessories'), 1, 24), 'Air Rifle Traps & Accessories', 'air-rifles--air-rifle-traps-and-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-rifles-springer'), 1, 24), 'Air Rifles Springer', 'air-rifles--air-rifles-springer', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-rifles-pcp'), 1, 24), 'Air Rifles PCP', 'air-rifles--air-rifles-pcp', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--co2-and-gas-ram-air-rifles'), 1, 24), 'CO2 & Gas-Ram Air Rifles', 'air-rifles--co2-and-gas-ram-air-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--air-rifle-slugs'), 1, 24), 'Air Rifle Slugs', 'air-rifles--air-rifle-slugs', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--pcp-compressors-pumps-and-cylinders'), 1, 24), 'PCP Compressors, Pumps & Cylinders', 'air-rifles--pcp-compressors-pumps-and-cylinders', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, true, false, true, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--airsoft'), 1, 24), 'Airsoft Guns & Rifles', 'air-rifles--airsoft', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'air-rifles--airsoft-gear-parts-and-bbs'), 1, 24), 'Airsoft Gear, Parts & BBs', 'air-rifles--airsoft-gear-parts-and-bbs', (SELECT "id" FROM "Category" WHERE "slug" = 'air-rifles'), false, false, true, false, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Cleaning Equipment
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--solvents'), 1, 24), 'Solvents', 'cleaning-equipment--solvents', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--sundry-equipment'), 1, 24), 'Sundry Equipment', 'cleaning-equipment--sundry-equipment', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--jags-and-rods'), 1, 24), 'Cleaning Rods & Pull-Throughs', 'cleaning-equipment--jags-and-rods', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--jags-mops-and-brushes'), 1, 24), 'Jags, Mops & Brushes', 'cleaning-equipment--jags-mops-and-brushes', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--cleaning-kits'), 1, 24), 'Cleaning Kits', 'cleaning-equipment--cleaning-kits', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--gun-oils-greases-and-lubricants'), 1, 24), 'Gun Oils, Greases & Lubricants', 'cleaning-equipment--gun-oils-greases-and-lubricants', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--bore-snakes-and-patches'), 1, 24), 'Bore Snakes & Patches', 'cleaning-equipment--bore-snakes-and-patches', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--cleaning-mats-vices-and-cradles'), 1, 24), 'Cleaning Mats, Vices & Cradles', 'cleaning-equipment--cleaning-mats-vices-and-cradles', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'cleaning-equipment--ultrasonic-cleaners'), 1, 24), 'Ultrasonic Cleaners', 'cleaning-equipment--ultrasonic-cleaners', (SELECT "id" FROM "Category" WHERE "slug" = 'cleaning-equipment'), false, false, true, true, false, false, true, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Firearms
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--pistols'), 1, 24), 'Pistols', 'firearms--pistols', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--centerfire-rifles'), 1, 24), 'Centerfire Rifles', 'firearms--centerfire-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--semi-automatic-rifles'), 1, 24), 'Semi-Automatic Rifles', 'firearms--semi-automatic-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--double-rifles'), 1, 24), 'Double Rifles', 'firearms--double-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--bespoke-rifles'), 1, 24), 'Bespoke Rifles', 'firearms--bespoke-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--revolvers'), 1, 24), 'Revolvers', 'firearms--revolvers', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--rimfire-rifles'), 1, 24), 'Rimfire Rifles', 'firearms--rimfire-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--over-and-under-shotguns'), 1, 24), 'Over & Under Shotguns', 'firearms--over-and-under-shotguns', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--semi-automatic-shotguns'), 1, 24), 'Semi-Automatic Shotguns', 'firearms--semi-automatic-shotguns', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--pump-action-shotguns'), 1, 24), 'Pump Action Shotguns', 'firearms--pump-action-shotguns', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--lever-action-rifles'), 1, 24), 'Lever-Action Rifles', 'firearms--lever-action-rifles', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--pistol-calibre-carbines-pcc'), 1, 24), 'Pistol-Calibre Carbines (PCC)', 'firearms--pistol-calibre-carbines-pcc', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--single-shot-rifles-and-shotguns'), 1, 24), 'Single-Shot Rifles & Shotguns', 'firearms--single-shot-rifles-and-shotguns', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--combination-guns-and-drillings'), 1, 24), 'Combination Guns & Drillings', 'firearms--combination-guns-and-drillings', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'firearms--side-by-side-shotguns'), 1, 24), 'Side-by-Side Shotguns', 'firearms--side-by-side-shotguns', (SELECT "id" FROM "Category" WHERE "slug" = 'firearms'), true, true, true, false, false, false, false, true, 15, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Gun Smithing & Parts
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--actions'), 1, 24), 'Actions', 'gun-smithing-parts--actions', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--barrels'), 1, 24), 'Barrels', 'gun-smithing-parts--barrels', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), true, true, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--rifle-parts-and-screws'), 1, 24), 'Rifle Parts & Screws', 'gun-smithing-parts--rifle-parts-and-screws', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--rifle-stocks'), 1, 24), 'Rifle Stocks', 'gun-smithing-parts--rifle-stocks', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--rifle-tools'), 1, 24), 'Rifle Tools', 'gun-smithing-parts--rifle-tools', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--silencers'), 1, 24), 'Silencers', 'gun-smithing-parts--silencers', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--triggers'), 1, 24), 'Triggers', 'gun-smithing-parts--triggers', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--ar-accessories'), 1, 24), 'AR Accessories', 'gun-smithing-parts--ar-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--ar-magazines'), 1, 24), 'AR Magazines', 'gun-smithing-parts--ar-magazines', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--pistol-magazines'), 1, 24), 'Pistol Magazines', 'gun-smithing-parts--pistol-magazines', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--rifle-magazines'), 1, 24), 'Rifle Magazines', 'gun-smithing-parts--rifle-magazines', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--chassis-systems'), 1, 24), 'Chassis Systems', 'gun-smithing-parts--chassis-systems', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--muzzle-brakes-and-compensators'), 1, 24), 'Muzzle Brakes & Compensators', 'gun-smithing-parts--muzzle-brakes-and-compensators', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--handgun-parts-sights-and-grips'), 1, 24), 'Handgun Parts, Sights & Grips', 'gun-smithing-parts--handgun-parts-sights-and-grips', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--shotgun-chokes-and-parts'), 1, 24), 'Shotgun Chokes & Parts', 'gun-smithing-parts--shotgun-chokes-and-parts', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 15, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'gun-smithing-parts--gunsmithing-supplies-finishes-and-coatings'), 1, 24), 'Gunsmithing Supplies, Finishes & Coatings', 'gun-smithing-parts--gunsmithing-supplies-finishes-and-coatings', (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts'), false, false, true, true, false, false, false, true, 16, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Optics
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--rifle-scopes'), 1, 24), 'Rifle Scopes', 'optics--rifle-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--binoculars'), 1, 24), 'Binoculars', 'optics--binoculars', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--rangefinders'), 1, 24), 'Rangefinders', 'optics--rangefinders', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--optical-cleaning-equipment'), 1, 24), 'Optical Cleaning Equipment', 'optics--optical-cleaning-equipment', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--night-vision'), 1, 24), 'Night Vision', 'optics--night-vision', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--spotting-scopes'), 1, 24), 'Spotting Scopes', 'optics--spotting-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--optical-tripods-and-window-mounts'), 1, 24), 'Optical Tripods & Window Mounts', 'optics--optical-tripods-and-window-mounts', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--scope-mounts'), 1, 24), 'Scope Mounts, Rings & Rails', 'optics--scope-mounts', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--air-rifle-scopes'), 1, 24), 'Air Rifle Scopes', 'optics--air-rifle-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--handgun-scopes'), 1, 24), 'Handgun Scopes', 'optics--handgun-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--trail-cameras'), 1, 24), 'Trail Cameras', 'optics--trail-cameras', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--rimfire-rifle-scopes'), 1, 24), 'Rimfire Rifle Scopes', 'optics--rimfire-rifle-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--rangefinder-binoculars'), 1, 24), 'Rangefinder Binoculars', 'optics--rangefinder-binoculars', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--rangefinding-rifle-scopes'), 1, 24), 'Rangefinding Rifle Scopes', 'optics--rangefinding-rifle-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--optical-accessories'), 1, 24), 'Optical Accessories', 'optics--optical-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 15, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--gps-and-comms'), 1, 24), 'GPS & Comms', 'optics--gps-and-comms', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 16, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--thermal-imaging'), 1, 24), 'Thermal Imaging', 'optics--thermal-imaging', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 17, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--drones'), 1, 24), 'Drones', 'optics--drones', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 18, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--red-dots-reflex-and-holographic-sights'), 1, 24), 'Red Dots, Reflex & Holographic Sights', 'optics--red-dots-reflex-and-holographic-sights', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, true, true, 19, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--magnifiers-and-prism-scopes'), 1, 24), 'Magnifiers & Prism Scopes', 'optics--magnifiers-and-prism-scopes', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 20, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'optics--lens-covers-sunshades-and-throw-levers'), 1, 24), 'Lens Covers, Sunshades & Throw Levers', 'optics--lens-covers-sunshades-and-throw-levers', (SELECT "id" FROM "Category" WHERE "slug" = 'optics'), false, false, true, true, false, false, false, true, 21, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Reloading Components
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components--rifle-bullets'), 1, 24), 'Rifle Bullets', 'reloading-components--rifle-bullets', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-components'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components--rifle-brass-cases'), 1, 24), 'Rifle Brass Cases', 'reloading-components--rifle-brass-cases', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-components'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components--handgun-bullets'), 1, 24), 'Handgun Bullets', 'reloading-components--handgun-bullets', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-components'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components--handgun-brass-cases'), 1, 24), 'Handgun Brass Cases', 'reloading-components--handgun-brass-cases', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-components'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-components--shotgun-hulls-wads-and-shot'), 1, 24), 'Shotgun Hulls, Wads & Shot', 'reloading-components--shotgun-hulls-wads-and-shot', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-components'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Shooting Accessories
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--ammo-boxes-and-storage-cases'), 1, 24), 'Ammo Boxes & Storage Cases', 'shooting-accessories--ammo-boxes-and-storage-cases', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--ballistic-software'), 1, 24), 'Ballistic Software', 'shooting-accessories--ballistic-software', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--bore-sighters'), 1, 24), 'Bore Sighters', 'shooting-accessories--bore-sighters', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--calling-equipment'), 1, 24), 'Calling Equipment', 'shooting-accessories--calling-equipment', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--chronographs'), 1, 24), 'Chronographs', 'shooting-accessories--chronographs', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, true, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--protection'), 1, 24), 'Hearing & Eye Protection', 'shooting-accessories--protection', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--holster'), 1, 24), 'Holsters & Mag Carriers', 'shooting-accessories--holster', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--rest-bipods-and-shooting-sticks'), 1, 24), 'Rest Bipods & Shooting Sticks', 'shooting-accessories--rest-bipods-and-shooting-sticks', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--rest-x-bags-and-rear-bags'), 1, 24), 'Rest X-Bags & Rear Bags', 'shooting-accessories--rest-x-bags-and-rear-bags', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--rifle-bags'), 1, 24), 'Rifle Bags', 'shooting-accessories--rifle-bags', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--rifle-safes'), 1, 24), 'Rifle Safes', 'shooting-accessories--rifle-safes', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--rifle-slings-and-straps'), 1, 24), 'Rifle Slings & Straps', 'shooting-accessories--rifle-slings-and-straps', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--targets-and-stands'), 1, 24), 'Targets & Stands', 'shooting-accessories--targets-and-stands', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--windmeters'), 1, 24), 'Windmeters', 'shooting-accessories--windmeters', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, true, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--weapons-mounted-lights'), 1, 24), 'Weapons Mounted Lights', 'shooting-accessories--weapons-mounted-lights', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, true, true, 15, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--ammo-pouch'), 1, 24), 'Ammo Pouches & Bandoliers', 'shooting-accessories--ammo-pouch', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 16, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--hard-cases-and-range-bags'), 1, 24), 'Hard Cases & Range Bags', 'shooting-accessories--hard-cases-and-range-bags', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 17, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--handgun-safes-and-vaults'), 1, 24), 'Handgun Safes & Vaults', 'shooting-accessories--handgun-safes-and-vaults', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 18, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--shooting-mats'), 1, 24), 'Shooting Mats', 'shooting-accessories--shooting-mats', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 19, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--steel-targets-and-gongs'), 1, 24), 'Steel Targets & Gongs', 'shooting-accessories--steel-targets-and-gongs', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, false, true, 20, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'shooting-accessories--shot-timers-and-training-aids'), 1, 24), 'Shot Timers & Training Aids', 'shooting-accessories--shot-timers-and-training-aids', (SELECT "id" FROM "Category" WHERE "slug" = 'shooting-accessories'), false, false, true, true, false, false, true, true, 21, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Fishing
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--reels'), 1, 24), 'Reels', 'fishing--reels', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 1, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--rods'), 1, 24), 'Rods', 'fishing--rods', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 2, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--lures'), 1, 24), 'Lures', 'fishing--lures', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 3, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--carp-baits'), 1, 24), 'Carp Baits', 'fishing--carp-baits', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 4, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--lines'), 1, 24), 'Lines', 'fishing--lines', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 5, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--terminal-tackle'), 1, 24), 'Terminal Tackle', 'fishing--terminal-tackle', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 6, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fishing-apparel'), 1, 24), 'Fishing Apparel', 'fishing--fishing-apparel', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 7, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fishing-footwear'), 1, 24), 'Fishing Footwear', 'fishing--fishing-footwear', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 8, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fishing-accessories'), 1, 24), 'Fishing Accessories', 'fishing--fishing-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 9, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fishing-by-technique'), 1, 24), 'Fishing By Technique', 'fishing--fishing-by-technique', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 10, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fishing-headwear'), 1, 24), 'Fishing Headwear', 'fishing--fishing-headwear', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 11, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fish-finders-and-electronics'), 1, 24), 'Fish Finders & Electronics', 'fishing--fish-finders-and-electronics', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, true, true, 12, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--kayaks-and-craft'), 1, 24), 'Kayaks & Craft', 'fishing--kayaks-and-craft', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, true, false, false, true, 13, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--rod-and-reel-combos'), 1, 24), 'Rod & Reel Combos', 'fishing--rod-and-reel-combos', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 14, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--fly-fishing-gear-and-fly-tying'), 1, 24), 'Fly Fishing Gear & Fly Tying', 'fishing--fly-fishing-gear-and-fly-tying', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 15, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--tackle-boxes-bags-and-rod-holdalls'), 1, 24), 'Tackle Boxes, Bags & Rod Holdalls', 'fishing--tackle-boxes-bags-and-rod-holdalls', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 16, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--rod-holders-banksticks-and-bite-alarms'), 1, 24), 'Rod Holders, Banksticks & Bite Alarms', 'fishing--rod-holders-banksticks-and-bite-alarms', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, true, true, 17, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--landing-nets-gaffs-and-weigh-scales'), 1, 24), 'Landing Nets, Gaffs & Weigh Scales', 'fishing--landing-nets-gaffs-and-weigh-scales', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 18, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--trolling-motors-and-marine-batteries'), 1, 24), 'Trolling Motors & Marine Batteries', 'fishing--trolling-motors-and-marine-batteries', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, true, false, true, true, 19, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--bait-boats'), 1, 24), 'Bait Boats', 'fishing--bait-boats', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, true, true, 20, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'fishing--inflatables-and-float-tubes'), 1, 24), 'Inflatables & Float Tubes', 'fishing--inflatables-and-float-tubes', (SELECT "id" FROM "Category" WHERE "slug" = 'fishing'), false, false, true, true, false, false, false, true, 21, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Camping & Outdoor
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--lights'), 1, 24), 'Lights', 'camping-outdoor--lights', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, true, true, 1, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--camping-and-outdoor-accessories'), 1, 24), 'Camping & Outdoor Accessories', 'camping-outdoor--camping-and-outdoor-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 2, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--sleeping-bags-mattresses-and-stretchers'), 1, 24), 'Sleeping Bags, Mattresses & Stretchers', 'camping-outdoor--sleeping-bags-mattresses-and-stretchers', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 3, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--camping-furniture'), 1, 24), 'Camping Furniture', 'camping-outdoor--camping-furniture', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 4, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--kids-camping'), 1, 24), 'Kids Camping', 'camping-outdoor--kids-camping', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 5, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--outdoor-gear'), 1, 24), 'Outdoor Gear', 'camping-outdoor--outdoor-gear', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 6, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--tents'), 1, 24), 'Tents', 'camping-outdoor--tents', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 7, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--stoves-and-cooking'), 1, 24), 'Stoves & Cooking', 'camping-outdoor--stoves-and-cooking', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 8, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--coolers-and-iceboxes'), 1, 24), 'Coolers & Iceboxes', 'camping-outdoor--coolers-and-iceboxes', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 9, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--water-filtration-and-storage'), 1, 24), 'Water Filtration & Storage', 'camping-outdoor--water-filtration-and-storage', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 10, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--backpacks-and-hiking-packs'), 1, 24), 'Backpacks & Hiking Packs', 'camping-outdoor--backpacks-and-hiking-packs', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 11, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--navigation-and-gps'), 1, 24), 'Navigation & GPS', 'camping-outdoor--navigation-and-gps', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, true, true, 12, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--hydration'), 1, 24), 'Hydration', 'camping-outdoor--hydration', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 13, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--gazebos-tarps-and-shade'), 1, 24), 'Gazebos, Tarps & Shade', 'camping-outdoor--gazebos-tarps-and-shade', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 14, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--braai-potjie-and-cast-iron'), 1, 24), 'Braai, Potjie & Cast Iron', 'camping-outdoor--braai-potjie-and-cast-iron', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 15, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--camp-showers-toilets-and-enclosures'), 1, 24), 'Camp Showers, Toilets & Enclosures', 'camping-outdoor--camp-showers-toilets-and-enclosures', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 16, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--solar-blankets-and-portable-power'), 1, 24), 'Solar Blankets & Portable Power', 'camping-outdoor--solar-blankets-and-portable-power', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, true, true, 17, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'camping-outdoor--trekking-poles-and-hiking-gear'), 1, 24), 'Trekking Poles & Hiking Gear', 'camping-outdoor--trekking-poles-and-hiking-gear', (SELECT "id" FROM "Category" WHERE "slug" = 'camping-outdoor'), false, false, true, true, false, false, false, true, 18, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Knives
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--custom-knives'), 1, 24), 'Custom Knives', 'knives--custom-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--tactical-knives'), 1, 24), 'Tactical Knives', 'knives--tactical-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--hunting-knives'), 1, 24), 'Hunting Knives', 'knives--hunting-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--pocket-knives'), 1, 24), 'Pocket Knives', 'knives--pocket-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--multitools'), 1, 24), 'Multitools', 'knives--multitools', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--knife-sets'), 1, 24), 'Knife Sets', 'knives--knife-sets', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--knife-sharpeners-and-sundries'), 1, 24), 'Knife Sharpeners & Sundries', 'knives--knife-sharpeners-and-sundries', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--axes'), 1, 24), 'Axes', 'knives--axes', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--biltong-cutters'), 1, 24), 'Biltong Cutters', 'knives--biltong-cutters', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--kitchen-knives'), 1, 24), 'Kitchen Knives', 'knives--kitchen-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--knife-and-multitool-pouches'), 1, 24), 'Knife & Multitool Pouches', 'knives--knife-and-multitool-pouches', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--fishing-knives'), 1, 24), 'Fishing Knives', 'knives--fishing-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 12, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--accessories-knives'), 1, 24), 'Knife Parts, Clips & Scales', 'knives--accessories-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 13, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--everyday-carry-edc-and-folding-knives'), 1, 24), 'Everyday Carry (EDC) & Folding Knives', 'knives--everyday-carry-edc-and-folding-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 14, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--skinning-and-caping-knives'), 1, 24), 'Skinning & Caping Knives', 'knives--skinning-and-caping-knives', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 15, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--machetes-pangas-and-bushcraft'), 1, 24), 'Machetes, Pangas & Bushcraft', 'knives--machetes-pangas-and-bushcraft', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 16, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'knives--knife-making-supplies-and-blanks'), 1, 24), 'Knife Making Supplies & Blanks', 'knives--knife-making-supplies-and-blanks', (SELECT "id" FROM "Category" WHERE "slug" = 'knives'), false, false, true, true, false, false, false, true, 17, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Self Defence
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--pepper-sprays'), 1, 24), 'Pepper Sprays', 'self-defence--pepper-sprays', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--launchers'), 1, 24), 'Launchers', 'self-defence--launchers', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--body-armour-and-plate-carriers'), 1, 24), 'Body Armour & Plate Carriers', 'self-defence--body-armour-and-plate-carriers', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--stun-guns-and-batons'), 1, 24), 'Stun Guns & Batons', 'self-defence--stun-guns-and-batons', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--projectiles-and-accessories'), 1, 24), 'Projectiles and Accessories', 'self-defence--projectiles-and-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--tactical-belts-pouches-and-chest-rigs'), 1, 24), 'Tactical Belts, Pouches & Chest Rigs', 'self-defence--tactical-belts-pouches-and-chest-rigs', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--tactical-torches-and-edc-lights'), 1, 24), 'Tactical Torches & EDC Lights', 'self-defence--tactical-torches-and-edc-lights', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, true, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--first-aid-ifak-and-trauma-kits'), 1, 24), 'First Aid, IFAK & Trauma Kits', 'self-defence--first-aid-ifak-and-trauma-kits', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'self-defence--home-security-alarms-and-beams'), 1, 24), 'Home Security, Alarms & Beams', 'self-defence--home-security-alarms-and-beams', (SELECT "id" FROM "Category" WHERE "slug" = 'self-defence'), false, false, true, true, false, false, true, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Paintball
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-accessories'), 1, 24), 'Paintball Accessories', 'paintball--paintball-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-masks'), 1, 24), 'Paintball Masks', 'paintball--paintball-masks', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-markers'), 1, 24), 'Paintball Markers', 'paintball--paintball-markers', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-barrels'), 1, 24), 'Paintball Barrels', 'paintball--paintball-barrels', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintballs'), 1, 24), 'Paintballs', 'paintball--paintballs', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-hoppers-and-accessories'), 1, 24), 'Paintball Hoppers & Accessories', 'paintball--paintball-hoppers-and-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--hpa-and-co2-tanks-and-regulators'), 1, 24), 'HPA & CO2 Tanks & Regulators', 'paintball--hpa-and-co2-tanks-and-regulators', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, true, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--pods-harnesses-and-vests'), 1, 24), 'Pods, Harnesses & Vests', 'paintball--pods-harnesses-and-vests', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'paintball--paintball-jerseys-pants-and-pads'), 1, 24), 'Paintball Jerseys, Pants & Pads', 'paintball--paintball-jerseys-pants-and-pads', (SELECT "id" FROM "Category" WHERE "slug" = 'paintball'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Reloading Equipment
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-dies'), 1, 24), 'Reloading Dies', 'reloading-equipment--reloading-dies', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-scales'), 1, 24), 'Reloading Scales', 'reloading-equipment--reloading-scales', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, true, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--measures'), 1, 24), 'Measures', 'reloading-equipment--measures', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-presses'), 1, 24), 'Reloading Presses', 'reloading-equipment--reloading-presses', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-kits'), 1, 24), 'Reloading Kits', 'reloading-equipment--reloading-kits', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-sundry-equipment'), 1, 24), 'Reloading Sundry Equipment', 'reloading-equipment--reloading-sundry-equipment', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--case-trimmers-prep-and-annealing'), 1, 24), 'Case Trimmers, Prep & Annealing', 'reloading-equipment--case-trimmers-prep-and-annealing', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, true, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--case-tumblers-and-cleaners'), 1, 24), 'Case Tumblers & Cleaners', 'reloading-equipment--case-tumblers-and-cleaners', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, true, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--priming-tools'), 1, 24), 'Priming Tools', 'reloading-equipment--priming-tools', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--calipers-micrometers-and-gauges'), 1, 24), 'Calipers, Micrometers & Gauges', 'reloading-equipment--calipers-micrometers-and-gauges', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'reloading-equipment--reloading-manuals-and-data'), 1, 24), 'Reloading Manuals & Data', 'reloading-equipment--reloading-manuals-and-data', (SELECT "id" FROM "Category" WHERE "slug" = 'reloading-equipment'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Overlanding & 4x4
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--rooftop-tents'), 1, 24), 'Rooftop Tents', 'overlanding--rooftop-tents', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 1, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--awnings-and-shade'), 1, 24), 'Awnings & Shade', 'overlanding--awnings-and-shade', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 2, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--fridges-and-freezers'), 1, 24), 'Fridges & Freezers', 'overlanding--fridges-and-freezers', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 3, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--batteries'), 1, 24), 'Batteries', 'overlanding--batteries', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, true, false, false, true, 4, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--solar-and-charging'), 1, 24), 'Solar & Charging', 'overlanding--solar-and-charging', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 5, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--recovery-gear'), 1, 24), 'Recovery Gear', 'overlanding--recovery-gear', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 6, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--drawer-and-storage-systems'), 1, 24), 'Drawer & Storage Systems', 'overlanding--drawer-and-storage-systems', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 7, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--roof-racks-and-load-bars'), 1, 24), 'Roof Racks & Load Bars', 'overlanding--roof-racks-and-load-bars', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 8, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--bull-bars-sliders-and-protection'), 1, 24), 'Bull Bars, Sliders & Protection', 'overlanding--bull-bars-sliders-and-protection', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 9, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--water-storage-and-systems'), 1, 24), 'Water Storage & Systems', 'overlanding--water-storage-and-systems', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 10, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--vehicle-lighting'), 1, 24), 'Vehicle Lighting', 'overlanding--vehicle-lighting', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 11, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--air-compressors-and-tyre-gear'), 1, 24), 'Air Compressors & Tyre Gear', 'overlanding--air-compressors-and-tyre-gear', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 12, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--trailers-and-off-road-caravans'), 1, 24), 'Trailers & Off-Road Caravans', 'overlanding--trailers-and-off-road-caravans', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, true, true, false, true, 13, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--overlanding-accessories'), 1, 24), 'Overlanding Accessories', 'overlanding--overlanding-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 14, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--suspension-and-lift-kits'), 1, 24), 'Suspension & Lift Kits', 'overlanding--suspension-and-lift-kits', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 15, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--snorkels-and-air-intakes'), 1, 24), 'Snorkels & Air Intakes', 'overlanding--snorkels-and-air-intakes', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 16, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--canopies-tonneau-and-load-bed'), 1, 24), 'Canopies, Tonneau & Load-Bed', 'overlanding--canopies-tonneau-and-load-bed', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 17, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--tyres-wheels-and-beadlocks'), 1, 24), 'Tyres, Wheels & Beadlocks', 'overlanding--tyres-wheels-and-beadlocks', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 18, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--fuel-and-jerry-cans'), 1, 24), 'Fuel & Jerry Cans', 'overlanding--fuel-and-jerry-cans', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 19, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--portable-power-and-inverters'), 1, 24), 'Portable Power & Inverters', 'overlanding--portable-power-and-inverters', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 20, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--towing-and-tow-bars'), 1, 24), 'Towing & Tow Bars', 'overlanding--towing-and-tow-bars', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 21, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--winches-and-winch-accessories'), 1, 24), 'Winches & Winch Accessories', 'overlanding--winches-and-winch-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 22, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--two-way-radios-and-vehicle-comms'), 1, 24), 'Two-Way Radios & Vehicle Comms', 'overlanding--two-way-radios-and-vehicle-comms', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, true, true, 23, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--camp-kitchens-and-drop-down-tables'), 1, 24), 'Camp Kitchens & Drop-Down Tables', 'overlanding--camp-kitchens-and-drop-down-tables', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 24, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--long-range-fuel-and-water-tanks'), 1, 24), 'Long-Range Fuel & Water Tanks', 'overlanding--long-range-fuel-and-water-tanks', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 25, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'overlanding--seat-covers-mats-and-interior-organisers'), 1, 24), 'Seat Covers, Mats & Interior Organisers', 'overlanding--seat-covers-mats-and-interior-organisers', (SELECT "id" FROM "Category" WHERE "slug" = 'overlanding'), false, false, true, true, false, false, false, true, 26, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Hunting
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--game-calls-and-decoys'), 1, 24), 'Game Calls & Decoys', 'hunting--game-calls-and-decoys', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--blinds-and-hides'), 1, 24), 'Blinds & Hides', 'hunting--blinds-and-hides', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--hunting-packs-and-bags'), 1, 24), 'Hunting Packs & Bags', 'hunting--hunting-packs-and-bags', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--field-dressing-and-butchery'), 1, 24), 'Field Dressing & Butchery', 'hunting--field-dressing-and-butchery', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--scent-control-and-attractants'), 1, 24), 'Scent Control & Attractants', 'hunting--scent-control-and-attractants', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--shooting-sticks-and-bipods'), 1, 24), 'Shooting Sticks & Bipods', 'hunting--shooting-sticks-and-bipods', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--hunting-accessories'), 1, 24), 'Hunting Accessories', 'hunting--hunting-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--ghillie-suits-and-camo-concealment'), 1, 24), 'Ghillie Suits & Camo Concealment', 'hunting--ghillie-suits-and-camo-concealment', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--meat-processing-mincers-and-biltong-dryers'), 1, 24), 'Meat Processing, Mincers & Biltong Dryers', 'hunting--meat-processing-mincers-and-biltong-dryers', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, true, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--dog-tracking-collars-and-field-gear'), 1, 24), 'Dog Tracking, Collars & Field Gear', 'hunting--dog-tracking-collars-and-field-gear', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, true, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'hunting--trophy-mounts-shields-and-skull-kits'), 1, 24), 'Trophy Mounts, Shields & Skull Kits', 'hunting--trophy-mounts-shields-and-skull-kits', (SELECT "id" FROM "Category" WHERE "slug" = 'hunting'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Outdoor Clothing & Footwear
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--jackets-and-shells'), 1, 24), 'Jackets & Shells', 'outdoor-clothing-footwear--jackets-and-shells', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 1, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--trousers-and-shorts'), 1, 24), 'Trousers & Shorts', 'outdoor-clothing-footwear--trousers-and-shorts', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 2, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--base-layers-and-thermals'), 1, 24), 'Base Layers & Thermals', 'outdoor-clothing-footwear--base-layers-and-thermals', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 3, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--hiking-and-hunting-boots'), 1, 24), 'Hiking & Hunting Boots', 'outdoor-clothing-footwear--hiking-and-hunting-boots', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--hats-caps-and-beanies'), 1, 24), 'Hats, Caps & Beanies', 'outdoor-clothing-footwear--hats-caps-and-beanies', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 5, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--gloves'), 1, 24), 'Gloves', 'outdoor-clothing-footwear--gloves', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 6, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--socks'), 1, 24), 'Socks', 'outdoor-clothing-footwear--socks', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 7, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--gaiters-and-accessories'), 1, 24), 'Gaiters & Accessories', 'outdoor-clothing-footwear--gaiters-and-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 8, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--fleece-hoodies-and-mid-layers'), 1, 24), 'Fleece, Hoodies & Mid-Layers', 'outdoor-clothing-footwear--fleece-hoodies-and-mid-layers', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 9, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--shirts-bush-shirts-and-polos'), 1, 24), 'Shirts, Bush Shirts & Polos', 'outdoor-clothing-footwear--shirts-bush-shirts-and-polos', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 10, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--rainwear-and-ponchos'), 1, 24), 'Rainwear & Ponchos', 'outdoor-clothing-footwear--rainwear-and-ponchos', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 11, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--hiking-and-trail-footwear'), 1, 24), 'Hiking & Trail Footwear', 'outdoor-clothing-footwear--hiking-and-trail-footwear', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 12, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--sandals-and-camp-footwear'), 1, 24), 'Sandals & Camp Footwear', 'outdoor-clothing-footwear--sandals-and-camp-footwear', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 13, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--belts-braces-and-sunglasses'), 1, 24), 'Belts, Braces & Sunglasses', 'outdoor-clothing-footwear--belts-braces-and-sunglasses', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 14, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'outdoor-clothing-footwear--wetsuits-and-watersports-apparel'), 1, 24), 'Wetsuits & Watersports Apparel', 'outdoor-clothing-footwear--wetsuits-and-watersports-apparel', (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear'), false, false, true, true, false, false, false, true, 15, true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- Archery & Bowhunting
INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--compound-bows'), 1, 24), 'Compound Bows', 'archery-bowhunting--compound-bows', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 1, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--recurve-and-traditional-bows'), 1, 24), 'Recurve & Traditional Bows', 'archery-bowhunting--recurve-and-traditional-bows', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 2, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--crossbows'), 1, 24), 'Crossbows', 'archery-bowhunting--crossbows', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 3, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--arrows-and-bolts'), 1, 24), 'Arrows & Bolts', 'archery-bowhunting--arrows-and-bolts', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 4, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--broadheads-and-points'), 1, 24), 'Broadheads & Points', 'archery-bowhunting--broadheads-and-points', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 5, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--releases-and-sights'), 1, 24), 'Releases & Sights', 'archery-bowhunting--releases-and-sights', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 6, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--targets'), 1, 24), 'Targets', 'archery-bowhunting--targets', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 7, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--archery-accessories'), 1, 24), 'Archery Accessories', 'archery-bowhunting--archery-accessories', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 8, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--quivers-rests-and-stabilisers'), 1, 24), 'Quivers, Rests & Stabilisers', 'archery-bowhunting--quivers-rests-and-stabilisers', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 9, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--bow-cases-and-bags'), 1, 24), 'Bow Cases & Bags', 'archery-bowhunting--bow-cases-and-bags', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 10, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

INSERT INTO "Category" ("id", "name", "slug", "parentId", "isFirearm", "requiresLicence", "availableSecondhand", "availableNewStore", "collectionOnly", "requiresPapers", "showTestedWorkingAttestation", "isActive", "sortOrder", "publicVisible")
VALUES ('c' || substr(md5(random()::text || clock_timestamp()::text || 'archery-bowhunting--bowstrings-cables-and-presses'), 1, 24), 'Bowstrings, Cables & Presses', 'archery-bowhunting--bowstrings-cables-and-presses', (SELECT "id" FROM "Category" WHERE "slug" = 'archery-bowhunting'), false, false, true, true, false, false, false, true, 11, false)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "showTestedWorkingAttestation" = EXCLUDED."showTestedWorkingAttestation",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder",
  "publicVisible" = EXCLUDED."publicVisible";

-- 3. Retire obsolete slugs --------------------------------------------
--
-- Re-home first: a listing must never be left pointing at a hidden row.
-- New categories default to publicVisible = false, so this is a one-way
-- hide - a migration must never be the thing that publishes a listing.

UPDATE "Listing" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'optics--optical-accessories')
WHERE "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'optics--previously-owned-optics');

UPDATE "Category" SET "isActive" = false, "publicVisible" = false WHERE "slug" = 'optics--previously-owned-optics';

UPDATE "Listing" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'outdoor-clothing-footwear--trousers-and-shorts')
WHERE "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'gun-smithing-parts--men-s-hunting-pants-and-shorts');

UPDATE "Category" SET "isActive" = false, "publicVisible" = false WHERE "slug" = 'gun-smithing-parts--men-s-hunting-pants-and-shorts';

UPDATE "Listing" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'paintball--paintballs')
WHERE "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'paintball--paintball-ammo');

UPDATE "Category" SET "isActive" = false, "publicVisible" = false WHERE "slug" = 'paintball--paintball-ammo';

-- One-directional listing resync for categories this migration hides.
UPDATE "Listing" l
SET "publicVisible" = false
FROM "Category" c
WHERE l."categoryId" = c."id"
  AND c."publicVisible" = false
  AND l."publicVisible" = true;
