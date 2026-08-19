-- Two more kinds of document the Licence Centre keeps.
--
-- DEDICATED_HUNTER is separate from DEDICATED_STATUS (which now means
-- dedicated SPORT SHOOTER) because they are two accreditations with two
-- certificates and two expiry dates, even where one association issues both.
--
-- PROFESSIONAL_HUNTER is a provincial nature-conservation registration. It is
-- deliberately NOT treated as section 16 dedicated status anywhere in the
-- application code — it evidences a different thing entirely — but it expires,
-- so members want it tracked.
--
-- ⚠️ ADD VALUE IS ONE-WAY. Postgres cannot drop an enum value, so a mistake
-- here is permanent. IF NOT EXISTS keeps a re-run safe.
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'DEDICATED_HUNTER';
ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'PROFESSIONAL_HUNTER';
