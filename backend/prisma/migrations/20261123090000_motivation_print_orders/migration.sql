-- Print-and-deliver for motivations: ONE Yoco payment covers the document, the
-- printing and the courier.
--
-- `Motivation.fulfilmentMode` records the second choice the member makes after
-- picking Motivation-only or Print-ready: DIGITAL ("Print / Download") or
-- DELIVER ("Print and Deliver", +R75 + courier).
--
-- `MotivationPayment` keeps the single gateway amount (`amountCents`) and now
-- carries the add-on split (print fee + shipping) plus the fulfilment row it
-- paid for. `Motivation.billedCents` continues to record the BASE price only.
--
-- `MotivationPrintOrder` is the desk's fulfilment record: address/contact
-- snapshot, courier quote, waybill and progress. It has no gateway columns —
-- there is no second transaction to reconcile.
--
-- Safe against production: the new column is defaulted, the payment columns are
-- defaulted/nullable, and the table starts empty. No existing row changes.

CREATE TYPE "MotivationPrintStatus" AS ENUM (
  'AWAITING_PAYMENT',
  'PAID',
  'BOOKING',
  'BOOKED',
  'DELIVERED',
  'CANCELLED'
);

ALTER TABLE "Motivation"
  ADD COLUMN "fulfilmentMode" VARCHAR(16) NOT NULL DEFAULT 'DIGITAL';

ALTER TABLE "MotivationPayment"
  ADD COLUMN "printFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "printOrderId" TEXT;

CREATE TABLE "MotivationPrintOrder" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "motivationId" TEXT,
  "userId" TEXT,
  "status" "MotivationPrintStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "motivationCents" INTEGER NOT NULL,
  "printFeeCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "deliveryAddress" JSONB NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "serviceName" TEXT,
  "serviceCode" TEXT,
  "providerSlug" TEXT,
  "serviceLevelCode" TEXT,
  "deliveryDaysMin" INTEGER,
  "deliveryDaysMax" INTEGER,
  "pdfEmailedAt" TIMESTAMP(3),
  "bookedAt" TIMESTAMP(3),
  "bobgoShipmentId" TEXT,
  "bobgoTrackingReference" TEXT,
  "waybillPin" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MotivationPrintOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MotivationPrintOrder_reference_key"
  ON "MotivationPrintOrder"("reference");
CREATE UNIQUE INDEX "MotivationPrintOrder_bobgoShipmentId_key"
  ON "MotivationPrintOrder"("bobgoShipmentId");
CREATE INDEX "MotivationPrintOrder_motivationId_status_idx"
  ON "MotivationPrintOrder"("motivationId", "status");
CREATE INDEX "MotivationPrintOrder_status_createdAt_idx"
  ON "MotivationPrintOrder"("status", "createdAt");
CREATE INDEX "MotivationPrintOrder_userId_createdAt_idx"
  ON "MotivationPrintOrder"("userId", "createdAt");
CREATE INDEX "MotivationPrintOrder_bobgoTrackingReference_idx"
  ON "MotivationPrintOrder"("bobgoTrackingReference");

CREATE UNIQUE INDEX "MotivationPayment_printOrderId_key"
  ON "MotivationPayment"("printOrderId");

ALTER TABLE "MotivationPrintOrder"
  ADD CONSTRAINT "MotivationPrintOrder_motivationId_fkey"
  FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MotivationPrintOrder"
  ADD CONSTRAINT "MotivationPrintOrder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MotivationPayment"
  ADD CONSTRAINT "MotivationPayment_printOrderId_fkey"
  FOREIGN KEY ("printOrderId") REFERENCES "MotivationPrintOrder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
