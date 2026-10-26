-- The first pass only corrected rows WE dated (`dateSource = 'read'`). A row
-- that went through the batch commit was stamped confirmedAt by confirmExpiry,
-- so it carried no dateSource and survived — the production proof of address
-- with 2027-01-31 in expiresOn is exactly that row.
--
-- A proof of address has no renewal expiry. Any date in this column is the
-- false read (a payment due date, a statement period end, a lease end), whoever
-- pressed the confirm button afterwards. Clear it for the kind unconditionally
-- so the licence-style reminder ladder cannot fire again, and let the
-- "is this still valid?" check run from issuedOn instead.
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
WHERE "kind" = 'ADDRESS_CONFIRMATION';
