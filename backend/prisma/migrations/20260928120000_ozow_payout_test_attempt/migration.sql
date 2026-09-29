-- Ozow payout TEST attempts: the persisted request record the verification
-- handshake needs for Ozow's mandatory money-out test cases, kept OUT of the
-- Transaction-anchored OzowPayoutAttempt table so no fabricated sale is ever
-- needed and test rows never reach payouts-due / held-funds / Zoho.

CREATE TABLE "OzowPayoutTestAttempt" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "OzowPayoutTestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OzowPayoutTestAttempt_gatewayPayoutId_key"
    ON "OzowPayoutTestAttempt"("gatewayPayoutId");
CREATE INDEX "OzowPayoutTestAttempt_merchantReference_idx"
    ON "OzowPayoutTestAttempt"("merchantReference");
CREATE INDEX "OzowPayoutTestAttempt_terminalAt_lastStatusCheckedAt_createdAt_idx"
    ON "OzowPayoutTestAttempt"("terminalAt", "lastStatusCheckedAt", "createdAt");
