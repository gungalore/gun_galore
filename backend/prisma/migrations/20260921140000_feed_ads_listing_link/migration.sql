-- Featured ads may promote a listing. Hand-written because `prisma migrate
-- dev` sees the intentional raw-DDL FTS columns as drift and offers to reset.
-- Apply with `migrate deploy`.

-- ctaUrl is now optional (a listing ad derives its destination from listingId)
ALTER TABLE "FeedAd" ALTER COLUMN "ctaUrl" DROP NOT NULL;

-- Link a listing
ALTER TABLE "FeedAd" ADD COLUMN "listingId" TEXT;

-- One ad per listing (Postgres allows many NULLs, so text ads are unaffected)
CREATE UNIQUE INDEX "FeedAd_listingId_key" ON "FeedAd"("listingId");

-- Foreign key: deleting a listing removes its ad
ALTER TABLE "FeedAd" ADD CONSTRAINT "FeedAd_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
