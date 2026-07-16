-- Daily Deals JIT fulfilment (DD-F) — Deal purchase orders.
--
-- Additive + safe: a new DealPurchaseOrder table + DealPoStatus enum. One PO
-- per Deal (unique dealId) so a sold house deal can raise a Zoho Books PO to
-- its supplier. The Zoho PO id lives in its own column for idempotency. FK
-- cascades on Deal delete so a removed deal takes its PO row with it.

-- CreateEnum
CREATE TYPE "DealPoStatus" AS ENUM ('DRAFT', 'PLACED', 'EMAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DealPurchaseOrder" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "unitsOrdered" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" "DealPoStatus" NOT NULL DEFAULT 'DRAFT',
    "zohoPurchaseOrderId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "stockReadyAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealPurchaseOrder_dealId_key" ON "DealPurchaseOrder"("dealId");

-- AddForeignKey
ALTER TABLE "DealPurchaseOrder" ADD CONSTRAINT "DealPurchaseOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
