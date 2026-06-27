-- Phase 7 P7.2 (additive): user-initiated support tickets + threaded replies.
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'AWAITING_USER', 'RESOLVED', 'CLOSED');

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "transactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketReply" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "fromAdmin" BOOLEAN NOT NULL DEFAULT false,
  "authorClerkId" TEXT,
  "adminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
CREATE INDEX "SupportTicketReply_ticketId_createdAt_idx" ON "SupportTicketReply"("ticketId", "createdAt");

ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketReply"
  ADD CONSTRAINT "SupportTicketReply_ticketId_fkey" FOREIGN KEY ("ticketId")
  REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
