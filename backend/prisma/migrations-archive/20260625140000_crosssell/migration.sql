-- Additive: marketplace cross-sell ("you might also need…").
-- Generic + data-driven so it works for every category, including future
-- ones, with no per-category code.

-- Eligibility/compliance gate: false hides a category's listings from
-- cross-sell suggestions. Set false for Ammo in seed-category-relations.mjs
-- (powder/primers/live ammo must never surface as a suggestion).
ALTER TABLE "Category" ADD COLUMN "crossSellEligible" BOOLEAN NOT NULL DEFAULT true;

-- Directional complementary relationships between categories.
CREATE TABLE "CategoryRelation" (
    "id" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "toCategoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requireExactMatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRelation_fromCategoryId_toCategoryId_key" ON "CategoryRelation"("fromCategoryId", "toCategoryId");

-- CreateIndex
CREATE INDEX "CategoryRelation_fromCategoryId_idx" ON "CategoryRelation"("fromCategoryId");

-- AddForeignKey
ALTER TABLE "CategoryRelation" ADD CONSTRAINT "CategoryRelation_fromCategoryId_fkey" FOREIGN KEY ("fromCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRelation" ADD CONSTRAINT "CategoryRelation_toCategoryId_fkey" FOREIGN KEY ("toCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
