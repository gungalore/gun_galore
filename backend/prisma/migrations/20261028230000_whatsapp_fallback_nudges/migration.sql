-- Fallback bookkeeping for sales-driving WhatsApp messages.
-- One timestamp per fallback path so each nudge fires at most once.
ALTER TABLE "WhatsappMessageLog"
  ADD COLUMN "undeliveredNudgeAt" TIMESTAMP(3),
  ADD COLUMN "unreadNudgeAt" TIMESTAMP(3);

-- The nudge sweep selects by status and age.
CREATE INDEX "WhatsappMessageLog_status_createdAt_idx"
  ON "WhatsappMessageLog"("status", "createdAt");
