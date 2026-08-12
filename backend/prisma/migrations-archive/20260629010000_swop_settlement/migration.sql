-- SWOP S5 — settlement + verification window (additive).
-- Both legs delivered → AWAITING_VERIFICATION with a verification window; after
-- it elapses with no dispute the cash releases and the swap completes. All
-- columns are nullable / additive — no destructive change.

ALTER TABLE "Swap" ADD COLUMN "verificationDeadlineAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "cashReleasedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "settlementTxId" TEXT;
ALTER TABLE "Swap" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "Swap" ADD COLUMN "disputeReason" TEXT;
ALTER TABLE "Swap" ADD COLUMN "disputeRaisedById" TEXT;

-- Backfill: S4 shipped AWAITING_VERIFICATION before this deadline column
-- existed, so any swap that both-delivered in the S4→S5 window has a NULL
-- deadline and the auto-release cron (verificationDeadlineAt not-null filter)
-- would skip it forever, stranding the held cash. Give those rows the window
-- they should have had (updatedAt was last written by the rollup). No-op when
-- there are none.
UPDATE "Swap"
SET "verificationDeadlineAt" = "updatedAt" + interval '48 hours'
WHERE status = 'AWAITING_VERIFICATION'
  AND "verificationDeadlineAt" IS NULL
  AND "cashReleasedAt" IS NULL;
