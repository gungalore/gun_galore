-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "senderClerkId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "originalContent" TEXT,
    "wasModerated" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_transactionId_createdAt_idx" ON "Message"("transactionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
