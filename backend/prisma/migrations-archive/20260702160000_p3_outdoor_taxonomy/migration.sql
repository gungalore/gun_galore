-- P3 — Outdoor taxonomy expansion + collection-only shipping + papers attestation.
--
-- Purely additive:
--   * one new ShippingMethod enum value (COLLECTION)
--   * two new Category flags (collectionOnly, requiresPapers) + snapshots on
--     Listing + a buyer-ack timestamp on Transaction
--   * new outdoor category tree (Overlanding & 4x4 incl. Trailers, Hunting,
--     Outdoor Clothing & Footwear, Archery & Bowhunting) + deepened Camping /
--     Fishing / Optics — all upserted BY SLUG so a re-run is a no-op and
--     nothing existing is renamed or deleted.
--   * the misfiled "Men's Hunting Pants & Shorts" (currently under Gun
--     Smithing & Parts, 0 listings) is DEACTIVATED and its home rebuilt under
--     the new Outdoor Clothing & Footwear root.
--
-- Kept in lockstep with prisma/seed.ts (the canonical source). Every INSERT
-- is ON CONFLICT (slug) DO UPDATE and every ALTER is IF NOT EXISTS, so this is
-- safe to replay. No DROPs; no touching of any runtime-added FTS/tsvector
-- columns (this file never diffs the schema — it is hand-applied via psql and
-- marked applied with `prisma migrate resolve`).

-- ─── 1. Enum: collection-in-person shipping ────────────────────────────────
ALTER TYPE "ShippingMethod" ADD VALUE IF NOT EXISTS 'COLLECTION';

-- ─── 2. Category flags ─────────────────────────────────────────────────────
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "collectionOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "requiresPapers" BOOLEAN NOT NULL DEFAULT false;

-- ─── 3. Listing snapshots ──────────────────────────────────────────────────
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "collectionOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "requiresPapers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "papersAttestedAt" TIMESTAMP(3);

-- ─── 4. Transaction: buyer papers acknowledgement ──────────────────────────
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "collectionPapersAckAt" TIMESTAMP(3);

-- ─── 5. Retire the misfiled apparel category (0 listings) ──────────────────
UPDATE "Category" SET "isActive" = false
WHERE slug = 'gun-smithing-parts--men-s-hunting-pants-and-shorts';

-- ─── 6. New ROOT categories ────────────────────────────────────────────────
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
VALUES
  (gen_random_uuid()::text,'Overlanding & 4x4','overlanding',            NULL,false,false,true,true,true,false,false,true,15,NOW()),
  (gen_random_uuid()::text,'Hunting','hunting',                          NULL,false,false,true,true,true,false,false,true,16,NOW()),
  (gen_random_uuid()::text,'Outdoor Clothing & Footwear','outdoor-clothing-footwear',NULL,false,false,true,true,true,false,false,true,17,NOW()),
  (gen_random_uuid()::text,'Archery & Bowhunting','archery-bowhunting',  NULL,false,false,true,true,true,false,false,true,18,NOW())
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  "parentId" = EXCLUDED."parentId",
  "isFirearm" = EXCLUDED."isFirearm",
  "requiresLicence" = EXCLUDED."requiresLicence",
  "availableSecondhand" = EXCLUDED."availableSecondhand",
  "availableNewStore" = EXCLUDED."availableNewStore",
  "collectionOnly" = EXCLUDED."collectionOnly",
  "requiresPapers" = EXCLUDED."requiresPapers",
  "isActive" = EXCLUDED."isActive",
  "sortOrder" = EXCLUDED."sortOrder";

-- Reusable child-insert shape: gen id, inherit non-firearm/non-licence,
-- marketplace + new-store on, cross-sell eligible; per-row collectionOnly /
-- requiresPapers / sortOrder come from the VALUES list; parent id is resolved
-- from the parent slug via a single-row CROSS JOIN.

-- ─── 6a. Overlanding & 4x4 children ────────────────────────────────────────
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, v.co, v.rp, true, v.so, NOW()
FROM (VALUES
  ('Rooftop Tents','overlanding--rooftop-tents',false,false,1),
  ('Awnings & Shade','overlanding--awnings-and-shade',false,false,2),
  ('Fridges & Freezers','overlanding--fridges-and-freezers',false,false,3),
  ('Dual-Battery & Solar','overlanding--dual-battery-and-solar',false,false,4),
  ('Recovery Gear','overlanding--recovery-gear',false,false,5),
  ('Drawer & Storage Systems','overlanding--drawer-and-storage-systems',false,false,6),
  ('Roof Racks & Load Bars','overlanding--roof-racks-and-load-bars',false,false,7),
  ('Bull Bars, Sliders & Protection','overlanding--bull-bars-sliders-and-protection',false,false,8),
  ('Water Storage & Systems','overlanding--water-storage-and-systems',false,false,9),
  ('Vehicle Lighting','overlanding--vehicle-lighting',false,false,10),
  ('Air Compressors & Tyre Gear','overlanding--air-compressors-and-tyre-gear',false,false,11),
  ('Trailers & Off-Road Caravans','overlanding--trailers-and-off-road-caravans',true,true,12),
  ('Overlanding Accessories','overlanding--overlanding-accessories',false,false,13)
) AS v(name, slug, co, rp, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'overlanding') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "collectionOnly" = EXCLUDED."collectionOnly", "requiresPapers" = EXCLUDED."requiresPapers",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- ─── 6b. Hunting children ──────────────────────────────────────────────────
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('Game Calls & Decoys','hunting--game-calls-and-decoys',1),
  ('Blinds & Hides','hunting--blinds-and-hides',2),
  ('Hunting Packs & Bags','hunting--hunting-packs-and-bags',3),
  ('Field Dressing & Butchery','hunting--field-dressing-and-butchery',4),
  ('Scent Control & Attractants','hunting--scent-control-and-attractants',5),
  ('Shooting Sticks & Bipods','hunting--shooting-sticks-and-bipods',6),
  ('Hunting Accessories','hunting--hunting-accessories',7)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'hunting') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- ─── 6c. Outdoor Clothing & Footwear children ──────────────────────────────
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('Jackets & Shells','outdoor-clothing-footwear--jackets-and-shells',1),
  ('Trousers & Shorts','outdoor-clothing-footwear--trousers-and-shorts',2),
  ('Base Layers & Thermals','outdoor-clothing-footwear--base-layers-and-thermals',3),
  ('Hiking & Hunting Boots','outdoor-clothing-footwear--hiking-and-hunting-boots',4),
  ('Hats, Caps & Beanies','outdoor-clothing-footwear--hats-caps-and-beanies',5),
  ('Gloves','outdoor-clothing-footwear--gloves',6),
  ('Socks','outdoor-clothing-footwear--socks',7),
  ('Gaiters & Accessories','outdoor-clothing-footwear--gaiters-and-accessories',8)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'outdoor-clothing-footwear') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- ─── 6d. Archery & Bowhunting children ─────────────────────────────────────
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('Compound Bows','archery-bowhunting--compound-bows',1),
  ('Recurve & Traditional Bows','archery-bowhunting--recurve-and-traditional-bows',2),
  ('Crossbows','archery-bowhunting--crossbows',3),
  ('Arrows & Bolts','archery-bowhunting--arrows-and-bolts',4),
  ('Broadheads & Points','archery-bowhunting--broadheads-and-points',5),
  ('Releases & Sights','archery-bowhunting--releases-and-sights',6),
  ('Targets','archery-bowhunting--targets',7),
  ('Archery Accessories','archery-bowhunting--archery-accessories',8)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'archery-bowhunting') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- ─── 7. Deepen existing outdoor roots (new children only) ──────────────────
-- Camping & Outdoor — add Tents + cooking/water/hiking essentials (existing
-- 6 children keep sortOrder 1-6; these append from 7).
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('Tents','camping-outdoor--tents',7),
  ('Stoves & Cooking','camping-outdoor--stoves-and-cooking',8),
  ('Coolers & Iceboxes','camping-outdoor--coolers-and-iceboxes',9),
  ('Water Filtration & Storage','camping-outdoor--water-filtration-and-storage',10),
  ('Backpacks & Hiking Packs','camping-outdoor--backpacks-and-hiking-packs',11),
  ('Navigation & GPS','camping-outdoor--navigation-and-gps',12),
  ('Hydration','camping-outdoor--hydration',13)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'camping-outdoor') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- Fishing — add electronics + paddle craft (existing 11 children keep 1-11).
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('Fish Finders & Electronics','fishing--fish-finders-and-electronics',12),
  ('Kayaks & Craft','fishing--kayaks-and-craft',13)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'fishing') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";

-- Optics — add navigation/comms + thermal + drones (existing 16 keep 1-16).
INSERT INTO "Category"
  ("id","name","slug","parentId","isFirearm","requiresLicence","availableSecondhand","availableNewStore","crossSellEligible","collectionOnly","requiresPapers","isActive","sortOrder","createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, p.id, false, false, true, true, true, false, false, true, v.so, NOW()
FROM (VALUES
  ('GPS & Comms','optics--gps-and-comms',17),
  ('Thermal Imaging','optics--thermal-imaging',18),
  ('Drones','optics--drones',19)
) AS v(name, slug, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'optics') AS p
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, "parentId" = EXCLUDED."parentId",
  "isActive" = EXCLUDED."isActive", "sortOrder" = EXCLUDED."sortOrder";
