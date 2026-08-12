-- EXP-E0 — Hunting Packages / Experiences: additive schema scaffolding (no money).
-- Additive only (new enum value, new enum type, new nullable/defaulted columns);
-- safe to run against a live prod table with zero backfill. Postgres 16.

-- 1) On-site-service fulfilment method. Deliberately matches NONE of the
--    courier-cron shippingMethod filters (PUDO/TCG/DEALER_TRANSFER/COLLECTION),
--    so experience bookings are invisible to every dispatch/auto-refund sweep.
ALTER TYPE "ShippingMethod" ADD VALUE IF NOT EXISTS 'ON_SITE_SERVICE';

-- 2) Experience kind (extensible later).
DO $$ BEGIN
  CREATE TYPE "ExperienceType" AS ENUM ('RANGE_DAY', 'PLAINS_GAME_HUNT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3) Category flag — "Hunting Packages & Experiences" sets this true; snapshotted
--    to Listing.isExperience at create (like isFirearm / collectionOnly).
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isExperience" BOOLEAN NOT NULL DEFAULT false;

-- 4) Listing experience + supplier columns.
ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "isExperience" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "experienceType" "ExperienceType",
  ADD COLUMN IF NOT EXISTS "eventStartDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventEndDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventProvince" "Province",
  ADD COLUMN IF NOT EXISTS "locationText" TEXT,
  ADD COLUMN IF NOT EXISTS "capacitySlots" INTEGER,
  ADD COLUMN IF NOT EXISTS "durationText" TEXT,
  ADD COLUMN IF NOT EXISTS "speciesList" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "whatsIncluded" TEXT,
  ADD COLUMN IF NOT EXISTS "rifleProvided" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supplierRegistrationNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierRegistrationDocUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierInsuranceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierAttestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supplierDocReviewStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierDocReviewScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "supplierDocReviewFindings" JSONB,
  ADD COLUMN IF NOT EXISTS "supplierDocReviewedAt" TIMESTAMP(3);
