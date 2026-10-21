-- Seller opt-in: the clip may be shown as the listing cover, ahead of photos.
-- Existing clips default to false so the first photo stays the cover.
ALTER TABLE "ListingVideo" ADD COLUMN "isHero" BOOLEAN NOT NULL DEFAULT false;
