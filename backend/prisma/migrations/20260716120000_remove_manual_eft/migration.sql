-- Remove the manual-EFT payment rail plumbing.
--
-- The site is not trading and needs no payment method / no fallback rail:
-- checkout is gated to a "card payments launching soon" 503 (Phase 1). This
-- migration drops the EFT-SPECIFIC storage — the inContact/statement
-- reconciliation audit rows (ManualPayment), the statement-upload history
-- (StatementUpload) and the FNB bulk-payment batch (PayoutBatch) — plus the
-- Transaction -> PayoutBatch link.
--
-- The rail-agnostic MONEY-STATE is deliberately left intact: sellerPayout /
-- commissionZar / processingFee / paidAt / paidOutAt, the refund children +
-- refundedAmount, the payout-hold + KYC/AVS gates, and the Order/OrderLineItem
-- layer are all UNCHANGED. A future card paygate reuses them. The inert manual
-- lifecycle scalar columns on Transaction/Order (orderReference, manualPayByAt,
-- manualDetectedAt, manualVerifiedAt, manualCancelledAt, manualWarn*) are also
-- retained: they are read for display / audit / release-gating by kept
-- money-state code and no longer written by any active rail.
--
-- Tables are dropped with CASCADE + IF EXISTS so the migration is idempotent
-- and self-cleans any remaining foreign-key constraints (e.g. the ManualPayment
-- FKs to Transaction/Order and the Transaction FK to PayoutBatch). Enums are
-- dropped after their referencing tables are gone.

-- DropIndex (old payout due-queue index that included payoutBatchId)
DROP INDEX IF EXISTS "Transaction_paymentStatus_paidOutAt_payoutBatchId_idx";

-- DropForeignKey / DropColumn (Transaction -> PayoutBatch link)
ALTER TABLE "Transaction" DROP CONSTRAINT IF EXISTS "Transaction_payoutBatchId_fkey";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "payoutBatchId";

-- CreateIndex (rail-agnostic payout due-queue: RELEASED/REFUNDED, not paid out)
CREATE INDEX IF NOT EXISTS "Transaction_paymentStatus_paidOutAt_idx"
  ON "Transaction" ("paymentStatus", "paidOutAt");

-- DropTable
DROP TABLE IF EXISTS "ManualPayment" CASCADE;
DROP TABLE IF EXISTS "StatementUpload" CASCADE;
DROP TABLE IF EXISTS "PayoutBatch" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "ManualPaymentSource";
DROP TYPE IF EXISTS "ManualPaymentStatus";
DROP TYPE IF EXISTS "PayoutBatchStatus";
