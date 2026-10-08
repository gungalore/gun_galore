-- Known sold prices: own completed sales + dealer lists. The highest-accuracy
-- comp source for the valuation engine.

CREATE TABLE "SoldComp" (
    "id" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "keySpec" TEXT,
    "condition" TEXT,
    "soldPriceCents" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'own',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldComp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SoldComp_categorySlug_make_model_idx" ON "SoldComp"("categorySlug", "make", "model");
CREATE INDEX "SoldComp_soldAt_idx" ON "SoldComp"("soldAt");
