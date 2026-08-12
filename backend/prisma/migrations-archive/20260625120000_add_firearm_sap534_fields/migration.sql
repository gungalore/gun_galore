-- Firearm SAP 534 workflow — additive, nullable columns on Listing.
-- P1: serial + licence capture & Claude-vision verification.
-- P2: one-time licence-expiry warning flag (daily delist cron).
-- P4: firearm "type" read back from the dealer-stamped 534.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "serialPhotoUrl" TEXT,
ADD COLUMN     "licencePhotoUrl" TEXT,
ADD COLUMN     "licenceHolderName" TEXT,
ADD COLUMN     "licenceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "licenceExpiryWarnedAt" TIMESTAMP(3),
ADD COLUMN     "firearmType" TEXT;
