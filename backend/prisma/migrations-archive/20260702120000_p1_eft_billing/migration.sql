-- P1 — first recurring revenue on the manual-EFT rail. Purely additive.
--
-- SubscriptionCharge gains the prepaid purchase lane: an SB-prefixed EFT
-- reference + pay-by window + the tier/period the payment buys.
-- Subscription gains the renewal-reminder idempotency stamp.
-- FeaturedSlotBid gains the FS-prefixed slot-fee payment lane so the
-- production bind block can be lifted (pay by EFT → slot activates).
-- No drops, no backfill, no behaviour change for existing rows.

ALTER TABLE "SubscriptionCharge" ADD COLUMN "orderReference" TEXT;
ALTER TABLE "SubscriptionCharge" ADD COLUMN "payByAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionCharge" ADD COLUMN "tierPurchased" "SubscriptionTier";
ALTER TABLE "SubscriptionCharge" ADD COLUMN "periodDays" INTEGER NOT NULL DEFAULT 31;
ALTER TABLE "SubscriptionCharge" ADD COLUMN "detectedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "SubscriptionCharge_orderReference_key" ON "SubscriptionCharge"("orderReference");
CREATE INDEX "SubscriptionCharge_status_payByAt_idx" ON "SubscriptionCharge"("status", "payByAt");

ALTER TABLE "Subscription" ADD COLUMN "renewalReminderAt" TIMESTAMP(3);

ALTER TABLE "FeaturedSlotBid" ADD COLUMN "orderReference" TEXT;
ALTER TABLE "FeaturedSlotBid" ADD COLUMN "pendingListingId" TEXT;
ALTER TABLE "FeaturedSlotBid" ADD COLUMN "paymentPayByAt" TIMESTAMP(3);
ALTER TABLE "FeaturedSlotBid" ADD COLUMN "paymentDetectedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "FeaturedSlotBid_orderReference_key" ON "FeaturedSlotBid"("orderReference");
