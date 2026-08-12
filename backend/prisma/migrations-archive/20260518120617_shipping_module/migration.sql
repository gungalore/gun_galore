-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('PUDO', 'TCG', 'DEALER_TRANSFER');

-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('PENDING', 'COLLECTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED');

-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "suburb" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" "Province" NOT NULL,
    "postalCode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_licenceNumber_key" ON "Dealer"("licenceNumber");

-- CreateIndex
CREATE INDEX "Dealer_province_idx" ON "Dealer"("province");

-- CreateIndex
CREATE INDEX "Dealer_isActive_idx" ON "Dealer"("isActive");
