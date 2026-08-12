-- Daily Deals JIT fulfilment (DD-F) — Suppliers.
--
-- Additive + safe: a new Supplier table + one nullable "supplierId" column on
-- Deal (with SET NULL FK + index). No existing rows change meaning; legacy
-- free-text "supplierName"/"supplierRef" on Deal are retained.
--
-- Supplier holds the collection warehouse (where The Courier Guy collects from)
-- plus a dedicated Zoho Books vendor id column for idempotent vendor sync.

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vatNumber" TEXT,
    "regNumber" TEXT,
    "warehouseStreet" TEXT NOT NULL,
    "warehouseSuburb" TEXT NOT NULL,
    "warehouseCity" TEXT NOT NULL,
    "warehouseProvince" "Province" NOT NULL,
    "warehousePostalCode" TEXT NOT NULL,
    "warehouseLat" DOUBLE PRECISION,
    "warehouseLng" DOUBLE PRECISION,
    "notes" TEXT,
    "zohoVendorId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_supplierId_idx" ON "Deal"("supplierId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
