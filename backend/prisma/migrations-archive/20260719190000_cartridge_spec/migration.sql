-- Load Lab cartridge reference specs (GRT-derived, adversarially match-verified).
CREATE TABLE "CartridgeSpec" (
    "cartridgeKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "grtName" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "origin" TEXT,
    "cartridgeType" TEXT,
    "year" INTEGER,
    "caseLengthMm" DOUBLE PRECISION,
    "maxCartridgeLengthMm" DOUBLE PRECISION,
    "maxPressureBar" INTEGER,
    "maxPressurePsi" INTEGER,
    "caseCapacityGrH2O" DOUBLE PRECISION,
    "officialPdfUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartridgeSpec_pkey" PRIMARY KEY ("cartridgeKey")
);
