-- A third notification channel gets its storage: WhatsApp.
--
-- `notifyWhatsappEnabled` (2026-08-22) and the `whatsapp_enabled` Setting have
-- existed with no provider behind them. This migration adds that provider's
-- tables — an outbound send log mirroring SmsLog, an inbound
-- customer-service-window tracker, the inbound messages themselves, and an
-- append-only consent trail for a Meta audit — plus the one column the
-- channel-preferences sheet needs on User.
--
-- ⚠️ This migration touches ONLY what is listed below. `prisma migrate dev`
-- on this box also wanted to drop `AskGgKbEntry.searchTsv` and
-- `ReloadingManualPage.textTsv` (the two tsvector GENERATED columns added at
-- boot by raw DDL — see CLAUDE.md's schema-drift trap) and a handful of other
-- unrelated index/column drift from this local database. None of that
-- belongs in a WhatsApp migration and none of it is included here — those
-- columns are boot-time DDL, not Prisma-managed, and dropping them in a
-- migration would delete the FTS indexes in production.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "channelPrefsPromptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsappMessageLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "vars" JSONB NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "WhatsappMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappThread" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "transactionId" TEXT,
    "windowOpenedAt" TIMESTAMP(3) NOT NULL,
    "windowClosesAt" TIMESTAMP(3) NOT NULL,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappInboundMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaMessageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappInboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_reference_idx" ON "WhatsappMessageLog"("reference");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_messageId_idx" ON "WhatsappMessageLog"("messageId");

-- CreateIndex
CREATE INDEX "WhatsappMessageLog_status_nextRetryAt_idx" ON "WhatsappMessageLog"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WhatsappThread_phone_idx" ON "WhatsappThread"("phone");

-- CreateIndex
CREATE INDEX "WhatsappThread_windowClosesAt_idx" ON "WhatsappThread"("windowClosesAt");

-- CreateIndex
CREATE INDEX "WhatsappThread_transactionId_idx" ON "WhatsappThread"("transactionId");

-- CreateIndex
CREATE INDEX "WhatsappInboundMessage_threadId_idx" ON "WhatsappInboundMessage"("threadId");

-- CreateIndex
CREATE INDEX "NotificationConsent_userId_channel_idx" ON "NotificationConsent"("userId", "channel");

-- AddForeignKey
ALTER TABLE "WhatsappInboundMessage" ADD CONSTRAINT "WhatsappInboundMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WhatsappThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
