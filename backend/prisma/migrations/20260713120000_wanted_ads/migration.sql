-- Wanted ads (demand capture): buyers post what they're looking for;
-- sellers respond with a link to one of their own ACTIVE listings and/or
-- a contact-filtered message. Purely additive — no money columns; any
-- transaction happens on the responder's normal listing.

-- CreateEnum
CREATE TYPE "WantedStatus" AS ENUM ('ACTIVE', 'CLOSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "WantedAd" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "province" "Province",
    "budgetMinCents" INTEGER,
    "budgetMaxCents" INTEGER,
    "status" "WantedStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WantedAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WantedResponse" (
    "id" TEXT NOT NULL,
    "wantedAdId" TEXT NOT NULL,
    "responderId" TEXT NOT NULL,
    "listingId" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WantedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WantedAd_status_expiresAt_createdAt_idx" ON "WantedAd"("status", "expiresAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WantedAd_categoryId_idx" ON "WantedAd"("categoryId");

-- CreateIndex
CREATE INDEX "WantedAd_userId_createdAt_idx" ON "WantedAd"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WantedResponse_wantedAdId_createdAt_idx" ON "WantedResponse"("wantedAdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WantedResponse_responderId_idx" ON "WantedResponse"("responderId");

-- CreateIndex
CREATE UNIQUE INDEX "WantedResponse_wantedAdId_responderId_listingId_key" ON "WantedResponse"("wantedAdId", "responderId", "listingId");

-- AddForeignKey
ALTER TABLE "WantedAd" ADD CONSTRAINT "WantedAd_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WantedAd" ADD CONSTRAINT "WantedAd_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_wantedAdId_fkey" FOREIGN KEY ("wantedAdId") REFERENCES "WantedAd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
