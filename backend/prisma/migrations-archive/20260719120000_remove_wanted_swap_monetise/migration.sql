-- Wanted-ads module REMOVED (operator decision 2026-07-19). Prod had 0 rows
-- in both tables at drop time.
DROP TABLE IF EXISTS "WantedResponse";
DROP TABLE IF EXISTS "WantedAd";
DROP TYPE IF EXISTS "WantedStatus";

-- SWOP monetisation: declared item value (ZAR cents) — drives the
-- value-based swap service fee, negotiation display, and dispute ceiling.
ALTER TABLE "Listing" ADD COLUMN "declaredValueCents" INTEGER;
