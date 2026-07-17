-- Sign-up consent (POPIA accountability) — set-once timestamps captured at
-- account creation + a separate marketing opt-in. Purely additive, all
-- nullable, no backfill (existing users predate the recorded-consent flow).

ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "privacyConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ageAffirmedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "consentPolicyVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "marketingConsentAt" TIMESTAMP(3);
