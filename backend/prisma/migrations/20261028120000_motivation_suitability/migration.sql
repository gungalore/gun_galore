-- The 5.2 suitability argument, stored per application.
ALTER TABLE "Motivation"
  ADD COLUMN "suitabilityEncrypted" TEXT,
  ADD COLUMN "suitabilityVersion" VARCHAR(40),
  ADD COLUMN "suitabilityHash" VARCHAR(64),
  ADD COLUMN "suitabilityAt" TIMESTAMP(3);
