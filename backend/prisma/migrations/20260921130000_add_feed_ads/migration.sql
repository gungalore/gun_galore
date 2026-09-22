-- Featured ads (fresh model; NOT the orphaned FeaturedSlot* tables).
-- Hand-written because `prisma migrate dev` detects the intentional raw-DDL
-- FTS columns (AskGgKbEntry.searchTsv, ReloadingManualPage.textTsv) as drift
-- and offers to reset the database. Never reset: apply with `migrate deploy`.

-- CreateEnum
CREATE TYPE "FeedAdStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateTable
CREATE TABLE "FeedAd" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT NOT NULL,
    "advertiser" TEXT,
    "status" "FeedAdStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "impressionCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedAd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedAd_status_sortOrder_idx" ON "FeedAd"("status", "sortOrder");
