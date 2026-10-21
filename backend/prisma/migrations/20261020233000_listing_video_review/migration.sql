-- Pending marketplace video review. A flagged clip can be kept for an admin
-- decision without holding the whole listing; public payloads only expose
-- APPROVED rows.
CREATE TYPE "ListingVideoStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

ALTER TABLE "ListingVideo"
  ADD COLUMN "status" "ListingVideoStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "moderationReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT;

CREATE INDEX "ListingVideo_status_createdAt_idx"
  ON "ListingVideo"("status", "createdAt");
