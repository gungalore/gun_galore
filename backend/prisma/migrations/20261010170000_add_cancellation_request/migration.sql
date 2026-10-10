-- Cancellation-REQUEST freeze (Phase 4 rework). Buyers can no longer
-- self-refund a paid order: they REQUEST a cancellation, which freezes the
-- order (no accept / booking / dispatch / payout), notifies the seller + admin,
-- and is then resolved by support with a fee-retained refund. While set (and
-- paymentStatus still HELD) the row renders as "Frozen — cancellation
-- requested". Idempotent so any environment that already has them is a no-op.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "cancellationRequestReason" TEXT;
