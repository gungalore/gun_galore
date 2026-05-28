-- CreateTable
CREATE TABLE "RangeEstimate" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "headingDeg" DOUBLE PRECISION,
    "tiltDeg" DOUBLE PRECISION,
    "rangeM" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "species" TEXT,
    "notes" TEXT,
    "modelUsed" TEXT NOT NULL,
    "biomeId" TEXT,
    "regionCode" TEXT,
    "costUsd" DECIMAL(10,6),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RangeEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RangeEstimate_deviceId_createdAt_idx" ON "RangeEstimate"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "RangeEstimate_biomeId_createdAt_idx" ON "RangeEstimate"("biomeId", "createdAt");
