-- Vicinity disclosure + the buyer's pre-payment acknowledgement.
--
-- All additive. Production holds zero listings and zero transactions carrying
-- these concepts, so no backfill is required; the columns are nullable so any
-- row that predates them reads as "not recorded" rather than "not agreed".

-- The town/province a buyer sees before they pay. pickupProvince is the source
-- of truth for Listing.province, which is also stamped onto the courier
-- collection address — deriving one from the other stops them diverging.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "pickupProvince" "Province";
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "publicLocality" VARCHAR(80);

-- Seed the new columns from what each row already holds, so existing listings
-- are consistent from the first request rather than after their next edit.
UPDATE "Listing" SET "pickupProvince" = "province" WHERE "pickupProvince" IS NULL;

-- Unconditional buyer acknowledgement, recorded per Transaction. NOT per User
-- (it is per purchase) and NOT on Order (orderId is null for every single-item
-- checkout, so an Order-level column would miss most sales entirely).
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "buyerTermsAckAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "buyerTermsAckVersion" VARCHAR(40);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "buyerLocationShown" VARCHAR(120);
