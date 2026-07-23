-- Weekly AI-written insights digest (Phase 4). Additive: one new table.

-- CreateTable
CREATE TABLE "InsightsDigest" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodDays" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "narrative" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightsDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsightsDigest_generatedAt_idx" ON "InsightsDigest"("generatedAt");
