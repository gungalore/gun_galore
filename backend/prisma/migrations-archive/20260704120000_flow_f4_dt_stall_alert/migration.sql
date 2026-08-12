-- FLOW-F4 (H12/H15) — DEALER_TRANSFER stall backstop idempotency stamp.
-- Set once when the DT stall sweep raises the urgent admin alert for a
-- firearm order whose seller accepted but never completed the dealer
-- transfer. Additive + idempotent.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "adminAlertedForDtStallAt" TIMESTAMP(3);
