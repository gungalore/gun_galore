-- Marketplace video sound choice.
--
-- New uploads default to muted (audio removed on delivery). Existing videos
-- were uploaded before the choice existed and already play with their audio,
-- so backfill them to true. The column default stays false for new rows.
ALTER TABLE "ListingVideo" ADD COLUMN "audioEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ListingVideo" SET "audioEnabled" = true;
