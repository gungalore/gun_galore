-- P4.1 — per-category attribute system (foundation).
--
-- Purely additive:
--   * new enum "AttributeType" (NUMBER | SELECT | TEXT | BOOLEAN)
--   * new table "CategoryAttribute" (DEFINES which structured specs a
--     category carries — litres, rod class, size…) with a FK to Category
--     (ON DELETE CASCADE), a UNIQUE(categoryId, key) and a browse index
--   * one new JSONB column on "Listing" ("attributes") where a listing
--     stores its VALUES keyed by CategoryAttribute.key (validation +
--     Meili faceting land in later phases — this migration only creates
--     the store)
--   * flagship attribute rows seeded per category, upserted BY
--     (categoryId, key) so a re-run is a no-op and nothing is renamed
--     or deleted.
--
-- Kept in lockstep with prisma/seed.ts (the canonical source). Every
-- ALTER is IF NOT EXISTS, the enum + constraints + indexes are guarded,
-- and every INSERT is ON CONFLICT ("categoryId","key") DO UPDATE, so this
-- is safe to replay. No DROPs; no touching of any runtime-added
-- FTS/tsvector columns (this file never diffs the schema — it is
-- hand-applied via psql and marked applied with `prisma migrate resolve`).

-- ─── 1. Enum: attribute value type ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttributeType') THEN
    CREATE TYPE "AttributeType" AS ENUM ('NUMBER', 'SELECT', 'TEXT', 'BOOLEAN');
  END IF;
END $$;

-- ─── 2. CategoryAttribute table (columns match the Prisma model exactly) ────
CREATE TABLE IF NOT EXISTS "CategoryAttribute" (
  "id"         TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "type"       "AttributeType" NOT NULL,
  "unit"       TEXT,
  "options"    TEXT[] NOT NULL DEFAULT '{}',
  "required"   BOOLEAN NOT NULL DEFAULT false,
  "filterable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("id")
);

-- FK → Category(id), cascade so deleting a category clears its attribute defs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CategoryAttribute_categoryId_fkey'
  ) THEN
    ALTER TABLE "CategoryAttribute"
      ADD CONSTRAINT "CategoryAttribute_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- @@unique([categoryId, key]) — one definition per key per category.
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryAttribute_categoryId_key_key"
  ON "CategoryAttribute" ("categoryId", "key");

-- @@index([categoryId, isActive, sortOrder]) — the effective-attribute lookup.
CREATE INDEX IF NOT EXISTS "CategoryAttribute_categoryId_isActive_sortOrder_idx"
  ON "CategoryAttribute" ("categoryId", "isActive", "sortOrder");

-- ─── 3. Listing attribute-value store ──────────────────────────────────────
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "attributes" JSONB;

-- ─── 4. Seed flagship attributes ───────────────────────────────────────────
-- One INSERT block per category. Parent id is resolved from the category
-- slug via a single-row CROSS JOIN (same shape as the P3 taxonomy
-- migration). options are Postgres text arrays in the listed order.
-- ON CONFLICT keeps the definition current on replay.

-- 4a. Overlanding & 4x4 — Fridges & Freezers
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('capacity_litres','Capacity','NUMBER','L', '{}'::text[],                                        true,  1),
  ('fridge_type',    'Fridge type','SELECT',NULL, ARRAY['Compressor','Absorption','Thermoelectric'], true,  2),
  ('power_supply',   'Power supply','SELECT',NULL, ARRAY['12V','240V','Dual 12V/240V'],              true,  3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'overlanding--fridges-and-freezers') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4b. Overlanding & 4x4 — Rooftop Tents
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('sleeps',           'Sleeps','NUMBER',NULL, '{}'::text[],                               true, 1),
  ('shell_type',       'Shell type','SELECT',NULL, ARRAY['Soft-shell','Hard-shell','Wedge'], true, 2),
  ('mattress_width_cm','Mattress width','NUMBER','cm', '{}'::text[],                        true, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'overlanding--rooftop-tents') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4c. Overlanding & 4x4 — Dual-Battery & Solar
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('battery_capacity_ah','Battery capacity','NUMBER','Ah', '{}'::text[],                        true, 1),
  ('battery_chemistry',  'Battery chemistry','SELECT',NULL, ARRAY['LiFePO4','AGM','Gel','Lead-acid'], true, 2),
  ('battery_wh',         'Battery energy','NUMBER','Wh', '{}'::text[],                          true, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'overlanding--dual-battery-and-solar') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4d. Fishing — Rods
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('rod_class',    'Rod class','SELECT',NULL, ARRAY['Ultra-light','Light','Medium','Medium-heavy','Heavy'], true, 1),
  ('rod_length_ft','Rod length','NUMBER','ft', '{}'::text[],                                                 true, 2),
  ('rod_pieces',   'Pieces','NUMBER',NULL, '{}'::text[],                                                     true, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'fishing--rods') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4e. Fishing — Reels  (gear_ratio is free-text and NOT filterable)
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('reel_type',  'Reel type','SELECT',NULL, ARRAY['Spinning','Baitcaster','Fly','Conventional'],                       true,  1),
  ('reel_size',  'Reel size','SELECT',NULL, ARRAY['1000','2500','3000','4000','5000','6000','8000','10000'],           true,  2),
  ('gear_ratio', 'Gear ratio','TEXT',NULL, '{}'::text[],                                                               false, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'fishing--reels') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4f. Outdoor Clothing & Footwear (ROOT — inherited by all children via the resolver)
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('gender',        'Gender','SELECT',NULL, ARRAY['Men','Women','Unisex','Kids'],                  true, 1),
  ('size',          'Size','SELECT',NULL, ARRAY['XS','S','M','L','XL','2XL','3XL'],                true, 2),
  ('new_with_tags', 'New with tags','BOOLEAN',NULL, '{}'::text[],                                  true, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'outdoor-clothing-footwear') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4g. Archery & Bowhunting — Compound Bows
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('draw_weight_lbs', 'Draw weight','NUMBER','lbs', '{}'::text[],       true, 1),
  ('draw_length_in',  'Draw length','NUMBER','in', '{}'::text[],        true, 2),
  ('axle_to_axle_in', 'Axle-to-axle','NUMBER','in', '{}'::text[],       true, 3),
  ('hand',            'Hand','SELECT',NULL, ARRAY['Right','Left'],      true, 4)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'archery-bowhunting--compound-bows') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- 4h. Camping & Outdoor — Tents
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, false, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('sleeps',        'Sleeps','NUMBER',NULL, '{}'::text[],                                  true, 1),
  ('season_rating', 'Season rating','SELECT',NULL, ARRAY['3-season','4-season'],           true, 2),
  ('tent_type',     'Tent type','SELECT',NULL, ARRAY['Dome','Tunnel','Geodesic','A-frame'],true, 3)
) AS v(key, label, type, unit, options, filterable, so)
CROSS JOIN (SELECT id FROM "Category" WHERE slug = 'camping-outdoor--tents') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";
