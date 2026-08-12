-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "bidCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buyNowPrice" INTEGER,
ADD COLUMN     "currentBid" INTEGER,
ADD COLUMN     "currentBidderId" TEXT,
ADD COLUMN     "durationDays" INTEGER,
ADD COLUMN     "endTime" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reserveMet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservePrice" INTEGER,
ADD COLUMN     "startTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "auctionStrikes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastStrikeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionWatch" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bid_listingId_createdAt_idx" ON "Bid"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE INDEX "AuctionWatch_userId_idx" ON "AuctionWatch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionWatch_listingId_userId_key" ON "AuctionWatch"("listingId", "userId");

-- CreateIndex
CREATE INDEX "Listing_endTime_idx" ON "Listing"("endTime");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_currentBidderId_fkey" FOREIGN KEY ("currentBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionWatch" ADD CONSTRAINT "AuctionWatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionWatch" ADD CONSTRAINT "AuctionWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
