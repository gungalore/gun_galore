-- FLOW-F3 — order-level EFT pay-reminder stamps. Additive + idempotent.
-- Multi-item orders previously got NO 12h/1h pay reminders (the per-tx
-- reminder sweep keys on Transaction.manualWarn*At, and order children carry
-- no manualPayByAt) and were swept to CANCELLED silently. These two stamps
-- give the order-level sweep the same idempotency the per-tx one has.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "manualWarn12hAt" TIMESTAMP(3);
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "manualWarn1hAt" TIMESTAMP(3);
