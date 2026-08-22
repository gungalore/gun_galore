-- MAY WE KEEP YOUR DOCUMENTS?
--
-- Operator, 2026-08-22: "we also need to launch a window asking the user for
-- us to keep the documents and explain why."
--
-- ⚠️ NOBODY HAS EVER BEEN ASKED. Documents attached to an application are
-- already retained and already offered back on the next one, and no record
-- anywhere says a member agreed to any of it. These columns are that record.
--
-- VERSIONED, AND THE VERSION IS STAMPED ON BOTH ANSWERS. A decline is a fact
-- worth keeping: it is what stops us asking again. And a gate that COMPARES a
-- stored version against the current one re-asks when the wording materially
-- changes — which User.consentPolicyVersion does not do, and is why it sat
-- frozen while the policies it pointed at moved underneath it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentVaultConsentVersion" VARCHAR(40);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentVaultConsentAt" TIMESTAMP(3);
-- Agreed once and withdrew since — NOT the same fact as never having agreed,
-- and not recoverable from a nulled timestamp.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentVaultConsentWithdrawnAt" TIMESTAMP(3);

-- ── the one-off copy of what they have already attached ───────────────────
-- A createdAt watermark. The backfill walks the member's uploads newest-first
-- and only ever looks at rows OLDER than this, so deleting a document from the
-- Centre can never bring it back on the next batch.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentVaultBackfillCursor" TIMESTAMP(3);
-- It reached the end. It never runs again.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentVaultBackfilledAt" TIMESTAMP(3);
