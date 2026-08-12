-- P5.2 platform-arranged shipment booking.
-- Additive only: four nullable columns on Transaction. No backfill, no
-- changes to existing rows or indexes.
ALTER TABLE "Transaction" ADD COLUMN "carrierShipmentId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "carrierDropoffPin" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "shipmentBookingStartedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "shipmentBookedAt" TIMESTAMP(3);
