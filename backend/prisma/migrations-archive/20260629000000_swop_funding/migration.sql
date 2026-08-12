-- SWOP/Trade S3 — two-sided funding columns on Swap (additive).
-- Each party funds the leg they send (courier + flat R50 fee + cash share +
-- 1.5% EFT handling). BOTH must fund for the swap to LOCK; a one-sided
-- failure reimburses the funded party. No drops, no backfill, no behaviour
-- change until the funding service is wired.

ALTER TABLE "Swap" ADD COLUMN "fundingSetUpAt" TIMESTAMP(3);

ALTER TABLE "Swap" ADD COLUMN "initiatorFundingRef" TEXT;
ALTER TABLE "Swap" ADD COLUMN "initiatorFundingAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Swap" ADD COLUMN "initiatorCourierCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Swap" ADD COLUMN "initiatorDetectedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "initiatorVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "initiatorRefundedAt" TIMESTAMP(3);

ALTER TABLE "Swap" ADD COLUMN "ownerFundingRef" TEXT;
ALTER TABLE "Swap" ADD COLUMN "ownerFundingAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Swap" ADD COLUMN "ownerCourierCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Swap" ADD COLUMN "ownerDetectedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "ownerVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "ownerRefundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Swap_initiatorFundingRef_key" ON "Swap"("initiatorFundingRef");
CREATE UNIQUE INDEX "Swap_ownerFundingRef_key" ON "Swap"("ownerFundingRef");
