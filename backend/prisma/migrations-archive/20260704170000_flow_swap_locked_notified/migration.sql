-- FLOW review-fix (LOW): make notifyLocked idempotent. Additive nullable
-- stamp on Swap; a CAS on lockedNotifiedAt stops the "swap locked"
-- email+SMS+inbox notification firing twice when sweepStalledLockedSwaps
-- re-drives a stalled locked swap.
ALTER TABLE "Swap" ADD COLUMN IF NOT EXISTS "lockedNotifiedAt" TIMESTAMP(3);
