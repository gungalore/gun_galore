-- Close the last public leaks the sitemap exposed.
--
-- 20260811180000_public_visibility gated the six regulated ROOTS. Verifying the
-- anonymous sitemap afterwards showed the taxonomy still put weapon words in
-- public, crawlable URLs from inside otherwise-innocent trees:
--
--   /category/optics--handgun-scopes          "handgun"
--   /category/optics--rifle-scopes            "rifle"
--   /category/optics--rimfire-rifle-scopes    "rifle"
--   /category/optics--rangefinding-rifle-scopes
--   /category/optics--air-rifle-scopes        (air rifles themselves are gated)
--   /category/hunting--shooting-sticks-and-bipods   "shooting"
--   /category/paintball--paintball-ammo       "ammo"
--
-- A gate that hides the Firearms tree but publishes "handgun-scopes" has not
-- done its job: the scanner reads the URL, not the intent.
--
-- Optics, Hunting and Paintball STAY PUBLIC as roots. Binoculars, spotting
-- scopes, rangefinders, trail cameras, thermal, drones and the rest of the
-- outdoor optics offering are unaffected.

-- 1. Gun-mounted optics + the duplicate shooting-rest category → members-only.
UPDATE "Category"
SET "publicVisible" = false
WHERE slug IN (
  'optics--rifle-scopes',
  'optics--handgun-scopes',
  'optics--rimfire-rifle-scopes',
  'optics--rangefinding-rifle-scopes',
  'optics--air-rifle-scopes',
  'hunting--shooting-sticks-and-bipods'
);

-- 2. Re-snapshot affected listings. Deliberately ONE-DIRECTIONAL: this only
--    ever HIDES. A blanket "mirror the category" resync would also flip
--    listings public, and a migration must never be the thing that publishes
--    something. Widening stays a conscious admin action.
UPDATE "Listing" l
SET "publicVisible" = false
FROM "Category" c
WHERE l."categoryId" = c.id
  AND c."publicVisible" = false
  AND l."publicVisible" = true;

-- 3. "Paintball Ammo" → "Paintballs". Renamed rather than gated: paintballs are
--    not ammunition and the category is legitimately public. Guarded on the
--    target slug being free so a re-run is a no-op rather than a unique-
--    constraint failure.
UPDATE "Category"
SET slug = 'paintball--paintballs', name = 'Paintballs'
WHERE slug = 'paintball--paintball-ammo'
  AND NOT EXISTS (
    SELECT 1 FROM "Category" x WHERE x.slug = 'paintball--paintballs'
  );
