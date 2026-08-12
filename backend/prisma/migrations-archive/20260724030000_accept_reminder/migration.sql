-- Mid-window seller accept reminder (48h accept deadline). Additive.
ALTER TABLE "Transaction" ADD COLUMN "acceptReminderSentAt" TIMESTAMP(3);
