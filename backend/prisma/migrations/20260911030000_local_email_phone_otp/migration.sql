-- Bring the email and phone one-time codes back in-house.
--
-- The self-hosted-auth migration handed both to Didit and dropped the phone
-- OTP columns outright. Two things sent them back, 2026-09-11:
--
--   * Cost. Didit bills $0.03 per email and $0.1048 per ZA SMS. Resend and
--     SMSPortal are already paid for and already carry every other message
--     this platform sends.
--   * Didit refuses phone verification entirely until the organisation makes
--     its first top-up — HTTP 403, "phone verification is disabled until your
--     organization's first top-up". Not a number problem, an account state.
--
-- Didit keeps the KYC identity session, which is the part it is uniquely good
-- at and the part that is free.
--
-- ⚠️ ADDITIVE ONLY. Every column is nullable or defaulted, so existing rows
-- need no backfill and nobody's verification state changes. `emailVerifiedAt`
-- and `phoneVerified` are untouched — a member already verified stays verified.

ALTER TABLE "User" ADD COLUMN "emailOtpHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailOtpExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0;

-- These three existed before the Didit cut-over and are being restored under
-- the same names, so a reader comparing against git history sees one round
-- trip rather than two unrelated designs.
ALTER TABLE "User" ADD COLUMN "phoneOtpHash" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneOtpExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0;
