-- The last public slug carrying a gated word: hiking-and-hunting-boots.
--
-- It sits in the CLOTHING tree, not the hunting tree, so the previous migration
-- (20260821140000_gate_optics_hunting) matched on the root segment and left it
-- behind. The product is boots. But the SLUG says "hunting", and a slug is a
-- public, crawlable URL — the same lesson as 20260811210000, where gating the
-- Firearms tree while publishing "optics--handgun-scopes" achieved nothing
-- because the scanner reads the URL, not the intent.
--
-- ⚠️ GATED, NOT RENAMED, AND THAT IS DELIBERATE. Renaming to
-- "hiking-and-outdoor-boots" would keep a legitimate clothing category public
-- and is arguably more accurate. It was rejected because Meta's Advertising
-- Standards and Ads Review Policy both prohibit evading or attempting to evade
-- review and enforcement, and relabelling a category to shed a flagged word —
-- on a domain under active restriction — is the shape of exactly that. Hiding
-- an empty category costs nothing; looking like we relabelled to get around a
-- reviewer could cost the appeal. Revisit once the restriction is lifted.
--
-- After this, zero public category slugs match
--   (hunt|knife|knive|blade|axe|bow|arrow|scope|sight|optic|gun|ammo|tactical|
--    weapon|shoot|paintball|archer)

UPDATE "Category"
SET "publicVisible" = false
WHERE slug = 'outdoor-clothing-footwear--hiking-and-hunting-boots';

-- One-directional listing resync, as in every gating migration before this.
UPDATE "Listing" l
SET "publicVisible" = false
FROM "Category" c
WHERE l."categoryId" = c.id
  AND c."publicVisible" = false
  AND l."publicVisible" = true;
