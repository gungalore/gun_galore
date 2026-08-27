-- Take a Shot stops being a listing type and becomes an option on any listing.
--
-- Operator, 2026-08-27: "Take a shot is not a third selling option. It needs to
-- be an option inside every buy now and auction listing. With the seller having
-- the option to turn off notifications for Take a shot offers."
--
-- Additive only. Both columns have defaults, so existing rows are correct the
-- moment this runs and there is nothing to backfill. Verified at cutover:
-- zero listings were using listingType = 'TAKE_A_SHOT', so no live listing
-- changes meaning here.
--
-- The TAKE_A_SHOT enum value is deliberately NOT dropped. It is referenced in
-- roughly forty files and dropping an in-use enum value is irreversible in
-- Postgres without a table rewrite; it simply stops being selectable. Removing
-- it is a separate, safe cleanup once those references are gone.

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "acceptsOffers" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "notifyOffersEnabled" BOOLEAN NOT NULL DEFAULT true;
