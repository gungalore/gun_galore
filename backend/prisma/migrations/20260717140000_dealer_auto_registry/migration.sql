-- Dealer auto-registration: provenance + review state on the Dealer directory.
-- Purely additive + non-destructive. Existing curated dealers backfill to
-- source='MANUAL', isVerified=true and keep every address value they have.
--
-- The four address components are relaxed to NULLABLE so an AUTO_VERIFICATION
-- entry (harvested from an approved firearm dealer-transfer, which may carry
-- only a raw OCR address) can be stored. Dropping NOT NULL never rewrites or
-- loses existing data.

ALTER TABLE "Dealer" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Dealer" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Dealer" ADD COLUMN "rawAddress" TEXT;
ALTER TABLE "Dealer" ADD COLUMN "firstSeenAt" TIMESTAMP(3);
ALTER TABLE "Dealer" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

ALTER TABLE "Dealer" ALTER COLUMN "suburb" DROP NOT NULL;
ALTER TABLE "Dealer" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "Dealer" ALTER COLUMN "province" DROP NOT NULL;
ALTER TABLE "Dealer" ALTER COLUMN "postalCode" DROP NOT NULL;

CREATE INDEX "Dealer_source_idx" ON "Dealer"("source");
