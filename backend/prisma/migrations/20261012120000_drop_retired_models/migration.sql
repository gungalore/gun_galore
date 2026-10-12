-- Retired-feature teardown (see AGENTS.md -> "Retired Features (do not rebuild)").
-- Drops the orphaned Prisma models for the featured-slot system, Daily Deals
-- and the PRO prize draw. `Listing.isDealListing` stays: it is a live
-- public-discovery predicate, so only the `Deal` overlay table it once
-- referenced is dropped, not the column.

DROP TABLE IF EXISTS "FeaturedSlotBid" CASCADE;
DROP TABLE IF EXISTS "FeaturedSlotAuditEvent" CASCADE;
DROP TABLE IF EXISTS "FeaturedSlotBidderBan" CASCADE;
DROP TABLE IF EXISTS "FeaturedSlotConfig" CASCADE;
DROP TABLE IF EXISTS "FeaturedAuction" CASCADE;
DROP TABLE IF EXISTS "FeaturedSlot" CASCADE;
DROP TABLE IF EXISTS "DealPurchaseOrder" CASCADE;
DROP TABLE IF EXISTS "Deal" CASCADE;
DROP TABLE IF EXISTS "Supplier" CASCADE;
DROP TABLE IF EXISTS "PrizeDraw" CASCADE;

DROP TYPE IF EXISTS "FeaturedSlotStatus";
DROP TYPE IF EXISTS "FeaturedAuctionStatus";
DROP TYPE IF EXISTS "FeaturedAuctionKind";
DROP TYPE IF EXISTS "FeaturedBidStatus";
DROP TYPE IF EXISTS "FeaturedTier";
DROP TYPE IF EXISTS "DealStatus";
DROP TYPE IF EXISTS "DealPoStatus";
DROP TYPE IF EXISTS "PrizeDrawStatus";
