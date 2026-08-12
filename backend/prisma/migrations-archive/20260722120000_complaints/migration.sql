-- Formal complaints register (CPA / Nedbank-TPPP oversight). Purely
-- additive: two new tables + their FKs/indexes. No existing table altered.

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "outcome" TEXT,
    "drovePayoutHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintPhoto" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_referenceNumber_key" ON "Complaint"("referenceNumber");
CREATE INDEX "Complaint_userId_createdAt_idx" ON "Complaint"("userId", "createdAt");
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");
CREATE INDEX "Complaint_transactionId_idx" ON "Complaint"("transactionId");
CREATE INDEX "ComplaintPhoto_complaintId_idx" ON "ComplaintPhoto"("complaintId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplaintPhoto" ADD CONSTRAINT "ComplaintPhoto_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
