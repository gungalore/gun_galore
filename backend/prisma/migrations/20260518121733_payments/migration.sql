-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('HELD', 'PENDING_ADMIN_VERIFICATION', 'RELEASED', 'DISPUTED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'PAYMENT_PENDING';

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "listingPrice" INTEGER NOT NULL,
    "commissionZar" INTEGER NOT NULL,
    "processingFee" INTEGER NOT NULL,
    "passFeeToBuyer" BOOLEAN NOT NULL,
    "buyerTotal" INTEGER NOT NULL,
    "sellerPayout" INTEGER NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'HELD',
    "peachCheckoutId" TEXT,
    "peachPaymentId" TEXT,
    "peachResultCode" TEXT,
    "paidAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "shippingMethod" "ShippingMethod",
    "shippingStatus" "ShippingStatus",
    "trackingReference" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "pudoDropoffLockerId" TEXT,
    "pudoPickupLockerId" TEXT,
    "pudoTrackingCode" TEXT,
    "deliveryAddress" JSONB,
    "tcgWaybill" TEXT,
    "dealerId" TEXT,
    "sellerKycClearedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "adminReviewedById" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_listingId_idx" ON "Transaction"("listingId");

-- CreateIndex
CREATE INDEX "Transaction_buyerId_idx" ON "Transaction"("buyerId");

-- CreateIndex
CREATE INDEX "Transaction_sellerId_idx" ON "Transaction"("sellerId");

-- CreateIndex
CREATE INDEX "Transaction_paymentStatus_idx" ON "Transaction"("paymentStatus");

-- CreateIndex
CREATE INDEX "Transaction_peachPaymentId_idx" ON "Transaction"("peachPaymentId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
