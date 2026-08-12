-- P1.3 — Books linkage for the two flat swap leg fees GG retains.
-- One Sales Receipt per paying party, booked at swap completion.
-- Additive only (house rule): two nullable columns, no data change.

ALTER TABLE "Swap" ADD COLUMN IF NOT EXISTS "zohoInitiatorFeeReceiptId" TEXT;
ALTER TABLE "Swap" ADD COLUMN IF NOT EXISTS "zohoOwnerFeeReceiptId" TEXT;
