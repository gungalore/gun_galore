-- Additive: cross-sell demand capture. One row per (fromCategory,
-- normalised calibre) where a cross-sell lookup found NO eligible
-- complements — incremented on each miss, surfaced in the admin
-- "unmet demand" report so the operator knows what stock to recruit.

CREATE TABLE "CrossSellMiss" (
    "id" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "calibre" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossSellMiss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrossSellMiss_fromCategoryId_calibre_key" ON "CrossSellMiss"("fromCategoryId", "calibre");

-- CreateIndex
CREATE INDEX "CrossSellMiss_count_idx" ON "CrossSellMiss"("count");
