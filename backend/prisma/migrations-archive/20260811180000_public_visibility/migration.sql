-- Members-only gating for regulated / weapon-adjacent categories.
--
-- The signed-out storefront must present as a new-and-secondhand OUTDOOR store:
-- no firearms, gun parts, reloading components, air rifles, self-defence or
-- shooting accessories visible to an anonymous visitor or a crawler. Signed-in
-- members see the full catalogue exactly as before.
--
-- ALLOWLIST, NOT BLOCKLIST. Both columns default FALSE, so anything that is
-- not explicitly published stays hidden — including categories added later.
-- The failure mode is "we forgot to show the tents", never "we leaked the
-- rifles". Do not change these defaults.

ALTER TABLE "Category" ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing"  ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the public outdoor roots. Everything omitted here (firearms,
-- gun-smithing-parts, reloading-components, reloading-equipment, air-rifles,
-- self-defence, shooting-accessories, ammo) stays false by design.
UPDATE "Category"
SET "publicVisible" = true
WHERE "slug" IN (
  'cleaning-equipment',
  'optics',
  'fishing',
  'camping-outdoor',
  'knives',
  'paintball',
  'overlanding',
  'hunting',
  'outdoor-clothing-footwear',
  'archery-bowhunting',
  'hunting-packages-experiences'
);

-- Children inherit from their parent (slug convention is `<parent>--<child>`,
-- but join on parentId so a future slug change cannot silently orphan this).
UPDATE "Category" AS c
SET "publicVisible" = true
FROM "Category" AS p
WHERE c."parentId" = p."id" AND p."publicVisible" = true;

-- Single-child carve-out: crossbows are weapons even though bows are not.
UPDATE "Category" SET "publicVisible" = false WHERE "slug" = 'archery-bowhunting--crossbows';

-- Belt and braces: a firearm category must never be public, whatever the
-- slug list above says.
UPDATE "Category" SET "publicVisible" = false WHERE "isFirearm" = true;

-- Snapshot onto listings, mirroring how isFirearm is snapshotted at create.
UPDATE "Listing" AS l
SET "publicVisible" = c."publicVisible"
FROM "Category" AS c
WHERE l."categoryId" = c."id";

-- Anonymous browse always filters status + publicVisible together.
CREATE INDEX "Listing_status_publicVisible_idx" ON "Listing"("status", "publicVisible");
