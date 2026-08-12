-- Automation batch 3: reminder / nudge / watchdog guard columns.
-- All nullable additions (+ SmsLog retry bookkeeping with safe defaults);
-- no existing behaviour changes until the new cron passes run.

-- Offer: one-shot seller "offer about to lapse" reminder guard + one-shot
-- buyer "pay before you lose it" reminder guard on accepted offers.
ALTER TABLE "Offer" ADD COLUMN "sellerRemindedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "buyerPayRemindedAt" TIMESTAMP(3);

-- Transaction: 48h courier confirm-receipt nudge guard + in-transit stall guard.
ALTER TABLE "Transaction" ADD COLUMN "buyerConfirmNudgedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "adminAlertedForTransitStallAt" TIMESTAMP(3);

-- Listing: auction ending-soon throttle, winner pay-reminder guard,
-- stale-listing renew cursor + nudge guard.
ALTER TABLE "Listing" ADD COLUMN "endingSoonNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "winnerRemindedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "lastRenewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Listing" ADD COLUMN "renewalNudgedAt" TIMESTAMP(3);

-- Seed lastRenewedAt from createdAt so the 75d/90d stale sweep measures age
-- from listing creation, not from "column added today" (which would give every
-- existing listing a fresh 90-day lease). New rows get now() from the default.
UPDATE "Listing" SET "lastRenewedAt" = "createdAt";

-- SmsLog: retry bookkeeping.
ALTER TABLE "SmsLog" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SmsLog" ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SmsLog" ADD COLUMN "nextRetryAt" TIMESTAMP(3);

CREATE INDEX "SmsLog_status_nextRetryAt_idx" ON "SmsLog"("status", "nextRetryAt");
