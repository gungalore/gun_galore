-- CreateEnum
CREATE TYPE "ManualPaymentSource" AS ENUM ('INCONTACT', 'STATEMENT');

-- CreateEnum
CREATE TYPE "ManualPaymentStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'REVERSED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "manualCancelledAt" TIMESTAMP(3),
ADD COLUMN     "manualDetectedAt" TIMESTAMP(3),
ADD COLUMN     "manualPayByAt" TIMESTAMP(3),
ADD COLUMN     "manualVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "manualWarn12hAt" TIMESTAMP(3),
ADD COLUMN     "manualWarn1hAt" TIMESTAMP(3),
ADD COLUMN     "orderReference" TEXT;

-- CreateTable
CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL,
    "source" "ManualPaymentSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "status" "ManualPaymentStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedTransactionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedById" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "creditRowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualPayment_externalId_key" ON "ManualPayment"("externalId");

-- CreateIndex
CREATE INDEX "ManualPayment_status_createdAt_idx" ON "ManualPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ManualPayment_reference_idx" ON "ManualPayment"("reference");

-- CreateIndex
CREATE INDEX "StatementUpload_createdAt_idx" ON "StatementUpload"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orderReference_key" ON "Transaction"("orderReference");

-- CreateIndex
CREATE INDEX "Transaction_manualPayByAt_idx" ON "Transaction"("manualPayByAt");

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
