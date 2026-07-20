-- Buy-Now on featured slots: mark a FeaturedSlotBid as an outright
-- purchase (2x tier price, skips the auction) rather than an auction bid.
ALTER TABLE "FeaturedSlotBid" ADD COLUMN "isBuyNow" BOOLEAN NOT NULL DEFAULT false;
