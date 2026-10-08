-- Value My Item: the valuation module's tables.
-- Hand-written because the dev DB carries intentional raw-DDL FTS drift, so
-- `prisma migrate dev` offers a reset. Applied with `prisma migrate deploy`.

CREATE TYPE "ValuationStatus" AS ENUM ('INTAKE', 'IDENTIFIED', 'ANSWERING', 'RESEARCHING', 'COMPLETED', 'FAILED', 'ABANDONED');
CREATE TYPE "ValuationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ValuationStatus" NOT NULL DEFAULT 'INTAKE',
    "description" TEXT,
    "categorySlug" TEXT,
    "strategy" TEXT,
    "identifyJson" JSONB,
    "questionsJson" JSONB,
    "answersJson" JSONB,
    "resultJson" JSONB,
    "rawFailureJson" TEXT,
    "identifyPromptVersion" TEXT,
    "researchPromptVersion" TEXT,
    "confidence" "ValuationConfidence",
    "lowPriceCents" INTEGER,
    "midPriceCents" INTEGER,
    "highPriceCents" INTEGER,
    "askingPriceCents" INTEGER,
    "expectedSalePriceCents" INTEGER,
    "retailAnchorCents" INTEGER,
    "cacheKey" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ValuationImage" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "viewTag" TEXT,
    "source" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "exifStrippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ValuationCaptureSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstUsedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "invalidAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationCaptureSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ValuationComp" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'USED_COMP',
    "sourceSite" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "model" TEXT,
    "condition" TEXT,
    "priceCents" INTEGER NOT NULL,
    "listedDate" TIMESTAMP(3),
    "pageOpened" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "excludeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationComp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ValuationCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "midPriceCents" INTEGER,
    "compCount" INTEGER NOT NULL,
    "confidence" "ValuationConfidence" NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ValuationOutcome" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "listingId" TEXT,
    "askingPriceCents" INTEGER,
    "soldPriceCents" INTEGER,
    "soldAt" TIMESTAMP(3),
    "daysToList" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationOutcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Valuation_userId_createdAt_idx" ON "Valuation"("userId", "createdAt");
CREATE INDEX "Valuation_status_idx" ON "Valuation"("status");

CREATE INDEX "ValuationImage_valuationId_idx" ON "ValuationImage"("valuationId");

CREATE UNIQUE INDEX "ValuationCaptureSession_token_key" ON "ValuationCaptureSession"("token");
CREATE INDEX "ValuationCaptureSession_userId_idx" ON "ValuationCaptureSession"("userId");
CREATE INDEX "ValuationCaptureSession_expiresAt_idx" ON "ValuationCaptureSession"("expiresAt");

CREATE INDEX "ValuationComp_valuationId_idx" ON "ValuationComp"("valuationId");
CREATE INDEX "ValuationComp_sourceSite_listedDate_idx" ON "ValuationComp"("sourceSite", "listedDate");

CREATE UNIQUE INDEX "ValuationCache_cacheKey_key" ON "ValuationCache"("cacheKey");
CREATE INDEX "ValuationCache_categorySlug_expiresAt_idx" ON "ValuationCache"("categorySlug", "expiresAt");

CREATE UNIQUE INDEX "ValuationOutcome_valuationId_key" ON "ValuationOutcome"("valuationId");
CREATE UNIQUE INDEX "ValuationOutcome_listingId_key" ON "ValuationOutcome"("listingId");
CREATE INDEX "ValuationOutcome_soldAt_idx" ON "ValuationOutcome"("soldAt");

ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationImage" ADD CONSTRAINT "ValuationImage_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "Valuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationCaptureSession" ADD CONSTRAINT "ValuationCaptureSession_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "Valuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationComp" ADD CONSTRAINT "ValuationComp_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "Valuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationOutcome" ADD CONSTRAINT "ValuationOutcome_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "Valuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ValuationOutcome" ADD CONSTRAINT "ValuationOutcome_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
