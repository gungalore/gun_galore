CREATE TABLE "OzowPayoutAttempt" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "gatewayPayoutId" TEXT,
    "siteCode" TEXT NOT NULL,
    "merchantReference" TEXT NOT NULL,
    "customerBankReference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isRtc" BOOLEAN NOT NULL,
    "notifyUrl" TEXT NOT NULL,
    "bankGroupId" TEXT NOT NULL,
    "encryptedAccountNumber" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "encryptionKeyCiphertext" TEXT NOT NULL,
    "encryptionKeyIv" TEXT NOT NULL,
    "encryptionKeyAuthTag" TEXT NOT NULL,
    "requestStatus" INTEGER,
    "requestSubStatus" INTEGER,
    "requestErrorMessage" TEXT,
    "lastStatus" INTEGER,
    "lastSubStatus" INTEGER,
    "lastStatusMessage" TEXT,
    "lastStatusCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OzowPayoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OzowPayoutAttempt_gatewayPayoutId_key"
    ON "OzowPayoutAttempt"("gatewayPayoutId");
CREATE INDEX "OzowPayoutAttempt_transactionId_createdAt_idx"
    ON "OzowPayoutAttempt"("transactionId", "createdAt");
CREATE INDEX "OzowPayoutAttempt_terminalAt_lastStatusCheckedAt_createdAt_idx"
    ON "OzowPayoutAttempt"("terminalAt", "lastStatusCheckedAt", "createdAt");

ALTER TABLE "OzowPayoutAttempt"
    ADD CONSTRAINT "OzowPayoutAttempt_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
