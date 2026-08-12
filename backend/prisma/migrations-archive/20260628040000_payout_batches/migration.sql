-- Phase P7.1: payout settlement (additive). PayoutBatch + Transaction payout
-- linkage. Inert until the admin freezes a batch — existing rows have
-- payoutBatchId/paidOutAt NULL, so every Phase 1–7/8 flow is unchanged.

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "payoutBatchId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "paidOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'PENDING',
    "payoutTotal" INTEGER NOT NULL,
    "refundTotal" INTEGER NOT NULL,
    "grandTotal" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "csv" TEXT NOT NULL,
    "createdById" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutBatch_status_createdAt_idx" ON "PayoutBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_paymentStatus_paidOutAt_payoutBatchId_idx" ON "Transaction"("paymentStatus", "paidOutAt", "payoutBatchId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
