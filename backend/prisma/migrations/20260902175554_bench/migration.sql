-- The Bench — the reverse load finder.
--
-- ADDITIVE ONLY. Ten new tables and their indexes; nothing existing is
-- altered or dropped.
--
-- ⚠️ HAND-FILTERED FROM `prisma migrate diff`, DELIBERATELY. The raw diff
-- also wanted to DROP COLUMN "searchTsv" on AskGgKbEntry and "textTsv" on
-- HuntPdfPage and ReloadingManualPage, plus six of their indexes. Those
-- columns are tsvector columns three services add at boot, so Prisma does
-- not know they exist and every diff proposes removing them. Applying that
-- would silently destroy full-text search on three tables. The same diff
-- also carried an unrelated MotivationUpload.ocrChars column belonging to
-- other in-flight work. All ten of those statements were excluded.

-- CreateTable
CREATE TABLE "BenchCartridge" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT,
    "origin" TEXT,
    "year" INTEGER,
    "caseLengthMm" DOUBLE PRECISION,
    "maxLengthMm" DOUBLE PRECISION,
    "pmaxPsi" INTEGER,
    "pmaxBar" INTEGER,

    CONSTRAINT "BenchCartridge_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BenchCartridgeAlias" (
    "id" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "printed" TEXT NOT NULL,

    CONSTRAINT "BenchCartridgeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchPowder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maker" TEXT,

    CONSTRAINT "BenchPowder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchPowderAlias" (
    "id" TEXT NOT NULL,
    "powderId" TEXT NOT NULL,
    "printed" TEXT NOT NULL,

    CONSTRAINT "BenchPowderAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchBulletMaker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],

    CONSTRAINT "BenchBulletMaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchSourceLoad" (
    "id" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "printedName" TEXT NOT NULL,
    "nameVerified" BOOLEAN NOT NULL,
    "bulletMaker" TEXT,
    "bulletType" TEXT NOT NULL,
    "bulletCategory" TEXT NOT NULL,
    "weightGr" DOUBLE PRECISION NOT NULL,
    "powderId" TEXT NOT NULL,
    "startGr" DOUBLE PRECISION NOT NULL,
    "startFps" INTEGER,
    "maxGr" DOUBLE PRECISION NOT NULL,
    "maxFps" INTEGER,
    "coalMm" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "sourcePage" INTEGER,
    "needsReview" TEXT,
    "loadId" TEXT,

    CONSTRAINT "BenchSourceLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchLoad" (
    "id" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "bulletMaker" TEXT NOT NULL,
    "bulletType" TEXT NOT NULL,
    "bulletCategory" TEXT NOT NULL,
    "weightGr" DOUBLE PRECISION NOT NULL,
    "powderId" TEXT NOT NULL,
    "startGr" DOUBLE PRECISION NOT NULL,
    "startFps" INTEGER,
    "maxGr" DOUBLE PRECISION NOT NULL,
    "maxFps" INTEGER,
    "coalMm" DOUBLE PRECISION,
    "coalLoMm" DOUBLE PRECISION,
    "coalHiMm" DOUBLE PRECISION,
    "sourcesCount" INTEGER NOT NULL,

    CONSTRAINT "BenchLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchCipDimension" (
    "cartridgeKey" TEXT NOT NULL,
    "R" DOUBLE PRECISION,
    "R1" DOUBLE PRECISION,
    "R3" DOUBLE PRECISION,
    "E" DOUBLE PRECISION,
    "E1" DOUBLE PRECISION,
    "eMin" DOUBLE PRECISION,
    "f" DOUBLE PRECISION,
    "beta" TEXT,
    "P1" DOUBLE PRECISION,
    "P2" DOUBLE PRECISION,
    "alpha" TEXT,
    "S" DOUBLE PRECISION,
    "r1Min" DOUBLE PRECISION,
    "r2" DOUBLE PRECISION,
    "H1" DOUBLE PRECISION,
    "H2" DOUBLE PRECISION,
    "G1" DOUBLE PRECISION,
    "G2" DOUBLE PRECISION,
    "F" DOUBLE PRECISION,
    "L1" DOUBLE PRECISION,
    "L2" DOUBLE PRECISION,
    "L3" DOUBLE PRECISION,
    "L4" DOUBLE PRECISION,
    "L5" DOUBLE PRECISION,
    "L6" DOUBLE PRECISION,
    "pmaxBar" INTEGER,
    "pkBar" INTEGER,
    "peBar" INTEGER,
    "M" DOUBLE PRECISION,
    "EE" DOUBLE PRECISION,
    "cL1" DOUBLE PRECISION,
    "cL2" DOUBLE PRECISION,
    "cL3" DOUBLE PRECISION,
    "cP1" DOUBLE PRECISION,
    "cP2" DOUBLE PRECISION,
    "cH1" DOUBLE PRECISION,
    "cH2" DOUBLE PRECISION,
    "cG" DOUBLE PRECISION,
    "cAlpha1" TEXT,
    "cH" DOUBLE PRECISION,
    "cS" DOUBLE PRECISION,
    "cI" TEXT,
    "cW" DOUBLE PRECISION,
    "bF" DOUBLE PRECISION,
    "bZ" DOUBLE PRECISION,
    "bB" DOUBLE PRECISION,
    "bN" INTEGER,
    "bU" DOUBLE PRECISION,
    "bQ" DOUBLE PRECISION,
    "tolerances" JSONB,
    "footnotes" JSONB,
    "rawText" TEXT NOT NULL,
    "tab" TEXT,
    "sheetDate" TEXT,
    "revision" TEXT,
    "imageOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BenchCipDimension_pkey" PRIMARY KEY ("cartridgeKey")
);

-- CreateTable
CREATE TABLE "UserBench" (
    "userId" TEXT NOT NULL,
    "powderIds" TEXT[],
    "bullets" JSONB NOT NULL,
    "cartridgeKeys" TEXT[],
    "units" TEXT NOT NULL DEFAULT 'metric',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBench_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BenchLogEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "bulletLabel" TEXT NOT NULL,
    "powderName" TEXT NOT NULL,
    "chargeGr" DOUBLE PRECISION NOT NULL,
    "coalMm" DOUBLE PRECISION,
    "primer" TEXT,
    "caseLabel" TEXT,
    "loadId" TEXT,
    "shotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "velocityMs" INTEGER,
    "groupMm" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenchCartridge_slug_key" ON "BenchCartridge"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BenchCartridgeAlias_printed_key" ON "BenchCartridgeAlias"("printed");

-- CreateIndex
CREATE UNIQUE INDEX "BenchPowder_name_key" ON "BenchPowder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BenchPowderAlias_printed_key" ON "BenchPowderAlias"("printed");

-- CreateIndex
CREATE UNIQUE INDEX "BenchBulletMaker_name_key" ON "BenchBulletMaker"("name");

-- CreateIndex
CREATE INDEX "BenchSourceLoad_cartridgeKey_weightGr_idx" ON "BenchSourceLoad"("cartridgeKey", "weightGr");

-- CreateIndex
CREATE INDEX "BenchLoad_powderId_idx" ON "BenchLoad"("powderId");

-- CreateIndex
CREATE UNIQUE INDEX "BenchLoad_cartridgeKey_bulletMaker_weightGr_bulletCategory__key" ON "BenchLoad"("cartridgeKey", "bulletMaker", "weightGr", "bulletCategory", "powderId");

-- CreateIndex
CREATE INDEX "BenchLogEntry_userId_createdAt_idx" ON "BenchLogEntry"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BenchCartridgeAlias" ADD CONSTRAINT "BenchCartridgeAlias_cartridgeKey_fkey" FOREIGN KEY ("cartridgeKey") REFERENCES "BenchCartridge"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchPowderAlias" ADD CONSTRAINT "BenchPowderAlias_powderId_fkey" FOREIGN KEY ("powderId") REFERENCES "BenchPowder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchSourceLoad" ADD CONSTRAINT "BenchSourceLoad_cartridgeKey_fkey" FOREIGN KEY ("cartridgeKey") REFERENCES "BenchCartridge"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchSourceLoad" ADD CONSTRAINT "BenchSourceLoad_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "BenchLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchLoad" ADD CONSTRAINT "BenchLoad_cartridgeKey_fkey" FOREIGN KEY ("cartridgeKey") REFERENCES "BenchCartridge"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchLoad" ADD CONSTRAINT "BenchLoad_powderId_fkey" FOREIGN KEY ("powderId") REFERENCES "BenchPowder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchCipDimension" ADD CONSTRAINT "BenchCipDimension_cartridgeKey_fkey" FOREIGN KEY ("cartridgeKey") REFERENCES "BenchCartridge"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
