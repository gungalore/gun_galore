-- A proof of address (and an employment letter / activity log) carries dates,
-- but none of them is a renewal deadline. Vision used to read a payment due
-- date, a statement period end or a lease end into Credential.expiresOn, and
-- the reminder sweep armed licence-style renewal reminders against it.
--
-- Only rows where WE supplied the date (`dateSource = 'read'`) are corrected.
-- A date the member typed or confirmed is theirs and is left alone.
UPDATE "Credential"
SET
  "expiresOn" = NULL,
  "dateSource" = NULL,
  "dateSourceNote" = NULL,
  "dateReadConfident" = false,
  "neverExpires" = true,
  "remind180SentAt" = NULL,
  "remind120SentAt" = NULL,
  "remind100SentAt" = NULL,
  "remind30SentAt" = NULL,
  "remindD0SentAt" = NULL
WHERE "kind" IN (
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  'SHOOTING_ACTIVITY_LOG'
)
AND "dateSource" = 'read';
