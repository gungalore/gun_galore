-- Profile-prefill consent, and a real uniqueness guarantee on uploads.
--
-- ── profileConsentAt ────────────────────────────────────────────────
-- Operator, 2026-08-18: ask the applicant before using their All Outdoor
-- profile details to fill the SAPS form.
--
-- Consent is RECORDED, not assumed, and it is recorded PER MOTIVATION rather
-- than once per account. Someone who agreed to us prefilling one application
-- has not thereby agreed to it forever, and a timestamp on the row is what lets
-- us answer "who allowed this, and when" months later. POPIA wants the
-- purpose to be specific; "you ticked something once" is not.
--
-- Nullable because every existing draft predates the question, and a draft with
-- no consent must behave as though the answer were no.
ALTER TABLE "Motivation" ADD COLUMN "profileConsentAt" TIMESTAMP(3);

-- ── upload de-duplication ───────────────────────────────────────────
-- MotivationUpload.sha256 carried an INDEX, and the upload path was going to
-- dedupe by reading it and then writing — which is a race, not a guarantee.
-- Two uploads of the same file arriving together both miss the read and both
-- insert, and the applicant sees the same certificate twice in their annexures.
--
-- Scoped to the motivation, not global: the same ID document legitimately
-- appears in two different people's applications, and even in the same person's
-- second application. Uniqueness across the table would reject that.
--
-- Safe against production: the table has no rows today — nothing in src has
-- ever created a MotivationUpload — so the constraint cannot fail on existing
-- data.
CREATE UNIQUE INDEX "MotivationUpload_motivationId_sha256_key"
  ON "MotivationUpload"("motivationId", "sha256");
