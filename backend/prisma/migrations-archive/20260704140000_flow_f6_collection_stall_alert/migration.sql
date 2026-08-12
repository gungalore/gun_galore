-- FLOW-F6 (H6/M4) — COLLECTION stall backstop idempotency stamps.
-- COLLECTION (in-person pickup) is excluded from every courier/DT sweep, so a
-- paid + accepted + never-collected order previously had no reminder and no
-- admin signal. These two stamps make the new collection stall sweep fire its
-- buyer nudge and urgent admin alert exactly once each. Additive + idempotent.
-- NO auto-refund on this path (operator policy — a human resolves).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "collectionConfirmNudgedAt" TIMESTAMP(3);

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "adminAlertedForCollectionStallAt" TIMESTAMP(3);
