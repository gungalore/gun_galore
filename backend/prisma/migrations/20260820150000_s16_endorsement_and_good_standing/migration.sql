-- Section 16 needs three separate documents from the association, and we had
-- one slot for all of them.
--
-- The three, as SA Hunters issues them (the operator's own pack, 2026-08-20):
--
--   1. The DEDICATED STATUS certificate    -> ASSOCIATION_CARD (already here)
--   2. The LETTER OF GOOD STANDING         -> GOOD_STANDING_LETTER (new)
--   3. The ENDORSEMENT for a firearm       -> ASSOCIATION_ENDORSEMENT (new)
--
-- The letter of good standing is the one section 16(2) of the Firearms Control
-- Act actually names: "a sworn statement or solemn declaration from the
-- chairperson of an accredited hunting association or sports-shooting
-- organisation, or someone delegated in writing by him or her, stating that
-- the applicant is a registered member". It carries an issue date and an
-- expiry date, which is why it also earns a place in the Licence Centre vault
-- alongside everything else that runs out.
--
-- The endorsement is NOT in the Act. It comes from the Hunters Forum
-- guidelines submitted to the Minister of Safety and Security on 2 September
-- 2005, and it certifies that one SPECIFIC firearm — type, calibre, make,
-- action, serial — is suitable for the discipline. Associations issue it and
-- DFOs expect it, which is reason enough to collect it; it is not reason to
-- tell a member the Act demands it.
--
-- ⚠️ ADD VALUE IS ONE-WAY. Postgres cannot drop an enum value, so a name
-- added here is permanent. IF NOT EXISTS so a re-run is harmless.

ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'GOOD_STANDING_LETTER';
ALTER TYPE "MotivationUploadKind" ADD VALUE IF NOT EXISTS 'ASSOCIATION_ENDORSEMENT';

ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'GOOD_STANDING';
