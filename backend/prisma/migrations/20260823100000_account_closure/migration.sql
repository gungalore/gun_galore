-- CLOSING AN ACCOUNT WITHOUT ERASING THE EVIDENCE.
--
-- Operator, 2026-08-22: "It must delete the profile from the public [side], but
-- still keep transaction links etc, reason for that is if a user commited a
-- crime or something they cant just vanish by deleting and wiping evidence."
--
-- ⚠️ accountClosedAt IS NOT isBanned, and conflating them was the first thing
-- this design rejected. isBanned is an enforcement flag; a closure is a member
-- exercising a choice. Reusing it would mean the admin Unban button silently
-- reopens a closed account with one click, and every admin view would read a
-- departure as misconduct.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountClosedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "User_accountClosedAt_idx" ON "User"("accountClosedAt");

-- ⚠️ WHY A SEPARATE TABLE AND NOT MORE COLUMNS.
--
-- 1. AdminAuditEvent cannot hold this. Its adminUserId is a REQUIRED FK to
--    AdminUser, and a member-initiated closure has no admin actor — so today
--    there is no record anywhere that a closure happened at all.
-- 2. The identity has to outlive the columns being cleared. Requirement B is
--    not met by keeping foreign keys; it is met by still being able to say WHO
--    they point at. Once username, email and phone are released back into the
--    uniqueness namespaces — which re-registration demands — the only place
--    the answer can live is a row nothing else writes to.
-- 3. Enforcement state has to survive re-registration. Every ban and strike is
--    a plain column on User with a default, so a new row is a clean row. This
--    is what carries them forward.
CREATE TABLE IF NOT EXISTS "AccountClosure" (
  "id"     TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  "closedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 'MEMBER' | 'ADMIN' | 'CLERK_WEBHOOK'
  "closedBy"        VARCHAR(16) NOT NULL,
  "closedByAdminId" TEXT,
  "reason"          TEXT NOT NULL,

  -- ── the identity snapshot ─────────────────────────────────────────
  -- ⚠️ IN THE CLEAR, AND DELIBERATELY. A law-enforcement or dispute request
  -- arrives as a name or a phone number, never as a cuid — and adminSearch
  -- keys on exactly these fields. They sit in the clear on User today, so
  -- moving them to an admin-only table is a net improvement, not a new
  -- exposure. The protection here is access control, not encryption.
  "closedUsername"  TEXT,
  "closedEmail"     TEXT NOT NULL,
  "closedPhone"     TEXT,
  "closedFirstName" TEXT,
  "closedLastName"  TEXT,
  -- A NON-UNIQUE copy of User.kycIdHash. The live hash stays on the User row
  -- and moves to the new account on re-registration; this copy is what keeps
  -- "this identity has been here before" true afterwards.
  "kycIdHashArchived" TEXT,

  -- ── enforcement carried forward ───────────────────────────────────
  -- Read by the relink when the same SA ID verifies on a new account. Without
  -- these, closing and re-registering is a clean slate — which is the
  -- ban-evasion hole the whole design turns on.
  "wasBanned"              BOOLEAN NOT NULL DEFAULT false,
  "wasBannedAt"            TIMESTAMP(3),
  "wasSellingBannedAt"     TIMESTAMP(3),
  "wasSellerRejectStrikes" INTEGER NOT NULL DEFAULT 0,
  "wasAuctionStrikes"      INTEGER NOT NULL DEFAULT 0,
  "wasDispatchStrikes"     INTEGER NOT NULL DEFAULT 0,
  "wasTrustScore"          INTEGER NOT NULL DEFAULT 0,

  "reRegisteredAsUserId" TEXT,
  "reRegisteredAt"       TIMESTAMP(3),

  -- Listing ids cancelled by this closure, so a failed re-index can be retried
  -- without re-deriving them from a row whose seller is now anonymous.
  "cancelledListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

  CONSTRAINT "AccountClosure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountClosure_userId_key" ON "AccountClosure"("userId");
CREATE INDEX IF NOT EXISTS "AccountClosure_closedAt_idx" ON "AccountClosure"("closedAt");
CREATE INDEX IF NOT EXISTS "AccountClosure_kycIdHashArchived_idx" ON "AccountClosure"("kycIdHashArchived");
CREATE INDEX IF NOT EXISTS "AccountClosure_closedUsername_idx" ON "AccountClosure"("closedUsername");

-- ⚠️ RESTRICT, NOT CASCADE, AND THAT IS THE WHOLE POINT. The closure record
-- must outlive any attempt to delete the User row it explains — otherwise the
-- one thing standing between "closed their account" and "vanished without
-- trace" disappears with a single DELETE.
ALTER TABLE "AccountClosure" DROP CONSTRAINT IF EXISTS "AccountClosure_userId_fkey";
ALTER TABLE "AccountClosure" ADD CONSTRAINT "AccountClosure_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
