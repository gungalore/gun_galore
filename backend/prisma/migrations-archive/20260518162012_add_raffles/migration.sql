-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED_AWAITING_DRAW', 'DRAWN', 'CLAIMED', 'CANCELLED_MIN_NOT_MET', 'CANCELLED_BY_ADMIN', 'EXPIRED_UNCLAIMED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'REFUNDED', 'POSTAL');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('PLATFORM_OWNED', 'SELLER_APPLICATION');

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "itemSource" "ItemSource" NOT NULL DEFAULT 'PLATFORM_OWNED',
    "itemValueCents" INTEGER NOT NULL,
    "isFirearm" BOOLEAN NOT NULL DEFAULT false,
    "targetTicketCount" INTEGER NOT NULL,
    "marginPercent" DOUBLE PRECISION NOT NULL,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "ticketPriceCents" INTEGER NOT NULL,
    "minTicketsRequired" INTEGER NOT NULL,
    "ticketsSoldPaid" INTEGER NOT NULL DEFAULT 0,
    "ticketsSoldPostal" INTEGER NOT NULL DEFAULT 0,
    "skillQuestion" TEXT NOT NULL,
    "skillAnswer" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "drawAt" TIMESTAMP(3),
    "drawnAt" TIMESTAMP(3),
    "claimDeadline" TIMESTAMP(3),
    "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
    "drawSeed" TEXT,
    "drawSeedHash" TEXT,
    "winningTicketId" TEXT,
    "parentRaffleId" TEXT,
    "relistGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "buyerId" TEXT,
    "ticketNumber" INTEGER NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "peachCheckoutId" TEXT,
    "peachPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "postalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleWinner" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT,
    "ticketId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "claimDeadline" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "forfeitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleWinner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalEntry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "enteredByAdminId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleSellerApplication" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemValueCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaffleSellerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleAuditEvent" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT,
    "actorUserId" TEXT,
    "actorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Raffle_status_idx" ON "Raffle"("status");

-- CreateIndex
CREATE INDEX "Raffle_endTime_idx" ON "Raffle"("endTime");

-- CreateIndex
CREATE INDEX "Raffle_drawAt_idx" ON "Raffle"("drawAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_referenceCode_key" ON "Ticket"("referenceCode");

-- CreateIndex
CREATE INDEX "Ticket_raffleId_status_idx" ON "Ticket"("raffleId", "status");

-- CreateIndex
CREATE INDEX "Ticket_buyerId_idx" ON "Ticket"("buyerId");

-- CreateIndex
CREATE INDEX "RaffleWinner_raffleId_idx" ON "RaffleWinner"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "RaffleWinner_raffleId_position_key" ON "RaffleWinner"("raffleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PostalEntry_referenceCode_key" ON "PostalEntry"("referenceCode");

-- CreateIndex
CREATE INDEX "PostalEntry_raffleId_idx" ON "PostalEntry"("raffleId");

-- CreateIndex
CREATE INDEX "RaffleSellerApplication_status_idx" ON "RaffleSellerApplication"("status");

-- CreateIndex
CREATE INDEX "RaffleAuditEvent_raffleId_createdAt_idx" ON "RaffleAuditEvent"("raffleId", "createdAt");

-- CreateIndex
CREATE INDEX "RaffleAuditEvent_eventType_idx" ON "RaffleAuditEvent"("eventType");

-- AddForeignKey
ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_parentRaffleId_fkey" FOREIGN KEY ("parentRaffleId") REFERENCES "Raffle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_postalEntryId_fkey" FOREIGN KEY ("postalEntryId") REFERENCES "PostalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleWinner" ADD CONSTRAINT "RaffleWinner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleWinner" ADD CONSTRAINT "RaffleWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleSellerApplication" ADD CONSTRAINT "RaffleSellerApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleAuditEvent" ADD CONSTRAINT "RaffleAuditEvent_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
