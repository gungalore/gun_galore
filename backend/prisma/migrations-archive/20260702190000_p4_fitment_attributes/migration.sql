-- P4.4 — vehicle-fitment attribute set + footwear size override.
--
-- Purely additive attribute DEFINITIONS (JSONB-over-EAV; no new model — the
-- audit's fitment finding is a client of the P4.1 CategoryAttribute system).
-- Fitment attrs go on the vehicle-mounted gear categories so a buyer can filter
-- "Hilux double-cab" and the cross-sell engine keys complements to the rig.
-- Every INSERT is ON CONFLICT (categoryId,key) DO UPDATE — safe to replay.
-- Kept in lockstep with prisma/seed.ts.

-- ─── Vehicle-fitment on rack / drawer / bull-bar-slider / awning categories ──
-- 5 attributes CROSS JOINed across the 4 vehicle-mounted-gear categories in one
-- statement. vehicle_make/cab_type/year are filterable facets; vehicle_model is
-- free text (too many models for a SELECT) — searched + used as the cross-sell
-- signal, so filterable=false. All optional (a rack can be universal-fit).
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, v.key, v.label, v.type::"AttributeType", v.unit, v.options, v.required, v.filterable, v.so, true, NOW()
FROM (VALUES
  ('vehicle_make','Vehicle make','SELECT',NULL, ARRAY['Toyota','Ford','Isuzu','Nissan','Volkswagen','Mitsubishi','Land Rover','Jeep','Mahindra','Suzuki','Other'], false, true, 1),
  ('vehicle_model','Vehicle model','TEXT',NULL, '{}'::text[], false, false, 2),
  ('vehicle_year_from','Fits from year','NUMBER',NULL, '{}'::text[], false, true, 3),
  ('vehicle_year_to','Fits to year','NUMBER',NULL, '{}'::text[], false, true, 4),
  ('cab_type','Cab / body','SELECT',NULL, ARRAY['Single Cab','Double Cab','Extra Cab','SUV / Wagon','Not vehicle-specific'], false, true, 5)
) AS v(key, label, type, unit, options, required, filterable, so)
CROSS JOIN (
  SELECT id FROM "Category" WHERE slug IN (
    'overlanding--roof-racks-and-load-bars',
    'overlanding--drawer-and-storage-systems',
    'overlanding--bull-bars-sliders-and-protection',
    'overlanding--awnings-and-shade'
  )
) AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, unit = EXCLUDED.unit,
  options = EXCLUDED.options, required = EXCLUDED.required,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";

-- ─── Footwear size override ──────────────────────────────────────────────────
-- The Outdoor Clothing & Footwear ROOT defines apparel `size` (XS…3XL), which
-- the resolver inherits onto every child. Boots need SHOE sizes, so define a
-- `size` attribute ON THE BOOTS LEAF — the resolver's nearest-wins dedup makes
-- the leaf's UK-size SELECT override the root's apparel size for boots only.
INSERT INTO "CategoryAttribute"
  ("id","categoryId","key","label","type","unit","options","required","filterable","sortOrder","isActive","createdAt")
SELECT gen_random_uuid()::text, c.id, 'size', 'Size (UK)', 'SELECT'::"AttributeType", NULL,
       ARRAY['UK 3','UK 4','UK 5','UK 6','UK 7','UK 8','UK 9','UK 10','UK 11','UK 12','UK 13'],
       false, true, 1, true, NOW()
FROM (SELECT id FROM "Category" WHERE slug = 'outdoor-clothing-footwear--hiking-and-hunting-boots') AS c
ON CONFLICT ("categoryId","key") DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, options = EXCLUDED.options,
  filterable = EXCLUDED.filterable, "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive";
