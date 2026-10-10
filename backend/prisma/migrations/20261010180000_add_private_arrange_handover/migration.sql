-- PRIVATE_ARRANGE held-funds handover (Phase 4 W2). Funds no longer release at
-- payment; the seller marks "delivered", the buyer confirms "received" (which
-- releases the payout), a 24h follow-up nudges a silent buyer, and funds
-- auto-release 5 days after payment if nothing disputes. Idempotent.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "privateArrangeDeliveredAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "privateArrangeReceivedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "privateArrangeRemindedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Transaction_shippingMethod_paymentStatus_paidAt_idx"
  ON "Transaction" ("shippingMethod", "paymentStatus", "paidAt");
