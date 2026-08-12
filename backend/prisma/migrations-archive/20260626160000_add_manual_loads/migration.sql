-- Recommended Loads: structured published-load rows extracted from the
-- reloading manuals. Additive only — creates one new table + indexes + FK.

CREATE TABLE "ManualLoad" (
    "id" TEXT NOT NULL,
    "cartridge" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "powderMaker" TEXT NOT NULL,
    "powderName" TEXT NOT NULL,
    "bulletMaker" TEXT,
    "bulletName" TEXT,
    "bulletWeightGr" DOUBLE PRECISION NOT NULL,
    "startGr" DOUBLE PRECISION NOT NULL,
    "maxGr" DOUBLE PRECISION NOT NULL,
    "startVelFps" INTEGER,
    "maxVelFps" INTEGER,
    "coalMm" DOUBLE PRECISION,
    "primer" TEXT,
    "caseMaker" TEXT,
    "barrelLenIn" DOUBLE PRECISION,
    "notes" TEXT,
    "manualId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualLoad_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualLoad_manualId_pageNumber_powderName_bulletWeightGr_sta_key"
    ON "ManualLoad"("manualId", "pageNumber", "powderName", "bulletWeightGr", "startGr");

CREATE INDEX "ManualLoad_cartridgeKey_bulletWeightGr_idx"
    ON "ManualLoad"("cartridgeKey", "bulletWeightGr");

CREATE INDEX "ManualLoad_manualId_idx" ON "ManualLoad"("manualId");

ALTER TABLE "ManualLoad"
    ADD CONSTRAINT "ManualLoad_manualId_fkey"
    FOREIGN KEY ("manualId") REFERENCES "ReloadingManual"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
