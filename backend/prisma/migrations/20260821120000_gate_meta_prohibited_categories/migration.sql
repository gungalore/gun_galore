-- Gate the product families Meta names by name in its Commerce Policies.
--
-- WHY THIS EXISTS: Meta restricted the site a SECOND time. The first response
-- (20260811180000_public_visibility, then 20260811210000_gate_weapon_adjacent_
-- categories) gated everything called "firearm" and everything whose SLUG
-- carried a weapon word — handgun-scopes, rifle-scopes, paintball-ammo.
--
-- ⚠️ THAT GATE WAS KEYED ON OUR VOCABULARY, NOT ON META'S. It asked "does this
-- URL look like a gun?" and so it kept as public exactly the categories Meta
-- itemises verbatim in its prohibited-commerce list:
--
--     https://www.facebook.com/policies_center/commerce/weapons_ammunition_and_explosives
--
--   edged weapons          → Meta names utility, hunting, combat and
--                            self-defence knives. Our whole `knives` tree.
--   bows and crossbows,    → Meta names the bows AND their parts AND their
--   their parts/projectiles  projectiles. Our whole `archery-bowhunting` tree
--                            (crossbows were already gated; the bows were not).
--   paintball / airsoft    → Meta names the markers AND their parts AND their
--   markers, parts, ammo     projectiles. Our whole `paintball` tree.
--   weapon accessories     → Meta names grips, sights and scopes.
--     such as sights/scopes  `optics--scope-mounts` is exactly that.
--
-- Measured before this migration ran: every one of these pages was public,
-- sitemapped, and served Meta's crawler an og:title reading "Tactical Knives
-- for sale", "Compound Bows for sale", "Broadheads & Points for sale",
-- "Paintball Markers for sale", "Scope Mounts for sale" — an offer, in the one
-- metadata field Meta's crawler exists to read, for goods Meta bans by name.
-- All of them rendered ZERO listings. This was pure exposure at zero revenue.
--
-- `cleaning-equipment` is included on a different ground: it is not on Meta's
-- list, but solvents, jags, rods, mops, brushes and cleaning kits are, in this
-- catalogue, firearm-specific. It is a gun-cleaning tree wearing a neutral name.
--
-- WHAT DELIBERATELY STAYS PUBLIC: optics (binoculars, spotting scopes,
-- rangefinders, trail cameras, night vision, thermal, drones), hunting,
-- camping, fishing, overlanding, clothing. Night vision and thermal appear only
-- in Meta's ADVERTISING standard, which reaches ads rather than a website — so
-- gating them would shrink the public catalogue for no gain unless and until we
-- advertise. That is a live judgement call, not an oversight.

-- 1. The four Meta-named families, roots and every child, plus scope mounts.
--    Matched on the root segment rather than an explicit slug list so a child
--    added since the taxonomy was written cannot slip through. (New categories
--    default to publicVisible = false anyway; this covers the ones already set
--    true.)
UPDATE "Category"
SET "publicVisible" = false
WHERE split_part(slug, '--', 1) IN (
    'knives',
    'archery-bowhunting',
    'paintball',
    'cleaning-equipment'
  )
  OR slug = 'optics--scope-mounts';

-- 2. Re-snapshot affected listings.
--
--    ⚠️ ONE-DIRECTIONAL, and for the same reason as the migration this copies:
--    it only ever HIDES. A blanket "mirror the category" resync would also flip
--    listings public, and a migration must never be the thing that publishes
--    something. Widening stays a conscious admin action.
UPDATE "Listing" l
SET "publicVisible" = false
FROM "Category" c
WHERE l."categoryId" = c.id
  AND c."publicVisible" = false
  AND l."publicVisible" = true;
