-- Admin auth hardening: revocable sessions, a second factor, and a lockout
-- that survives a deploy.
--
-- WHY NOW. The Desk admin session is the credential that will shortly be able
-- to approve a Warden command, and approving one turns an admin session into a
-- shell on the production box. Until this migration that credential was a
-- single eight-hour bearer JWT living in localStorage with:
--   * no server-side revocation — `POST /admin/auth/logout` cleared a cookie
--     that AdminJwtGuard never read, so signing out revoked nothing;
--   * no second factor — one password was the whole of it;
--   * no durable brute-force brake — only the in-memory throttler, whose
--     store every `pm2 reload` wipes, so each deploy handed an attacker a
--     fresh ten-attempts-a-minute budget.
--
-- ⚠️ THIS MIGRATION IS PURELY ADDITIVE. It drops nothing, rewrites no row and
-- back-fills no value: three nullable columns, two defaulted columns, two new
-- tables. The existing AdminUser rows and their password hashes are untouched.
--
-- ⚠️ IT DOES, HOWEVER, END EVERY LIVE DESK SESSION the moment the new backend
-- serves traffic — not because anything here deletes one, but because the
-- guard now requires a `sid` claim that tokens minted before this deploy do
-- not carry. That is the point rather than a side effect: a token with no
-- session row behind it is exactly the non-revocable eight-hour bearer this
-- work exists to remove, and there would be no way to revoke it later. The
-- operator signs in again. Deploy this when they are at a keyboard.
--
-- ⚠️ THE SECOND FACTOR IS NOT SWITCHED ON BY THIS FILE. `ADMIN_TOTP_REQUIRED`
-- is read from the environment and defaults to off, so the order is: deploy,
-- enrol, scan, confirm, THEN set the flag. Setting the flag first locks the
-- only operator out of the only admin surface with no way back in short of
-- ssh.

-- ─── AdminUser: the second factor and the lockout ───────────────────────────

-- Base32 TOTP secret. Nullable because an admin who has not enrolled has none,
-- and because login must treat "not enrolled" and "enrolled" differently.
ALTER TABLE "AdminUser" ADD COLUMN "totpSecret" TEXT;

-- ⚠️ A SECRET WITHOUT A CONFIRMATION IS NOT A SECOND FACTOR, IT IS A LOCKOUT.
-- Enrolment hands the operator a secret and a QR code; if they close the tab
-- between scanning and confirming — or scan it into the wrong app — the row
-- would carry a secret no phone can answer. Login therefore ignores
-- totpSecret entirely until this timestamp is set, which happens only after a
-- code minted from that exact secret has verified.
ALTER TABLE "AdminUser" ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);

-- ⚠️ AN ENROLMENT IN PROGRESS IS STAGED HERE, NEVER IN totpSecret. Writing the
-- new secret straight into totpSecret (and nulling the confirmation) is a
-- privilege escalation, not a tidier two-step: the enrol route is reachable by
-- a READ-ONLY recovery session on purpose — losing your phone is exactly when
-- you must be able to enrol a new one — and login treats an unconfirmed secret
-- as "no second factor". So one POST turned the factor off, the next
-- password-only sign-in came back with full write, and the ten recovery codes
-- stopped being checked at all because that branch only runs when enrolled.
-- Staging keeps the working factor intact until a code from the new secret
-- verifies, so abandoning an enrolment changes nothing.
ALTER TABLE "AdminUser" ADD COLUMN "totpPendingSecret" TEXT;

-- Failed sign-ins since the last success. Mirrors User.failedLoginCount.
--
-- ⚠️ DEFAULT 0 AND NOT NULL, so the increment is arithmetic rather than a
-- null-check every caller could forget. The existing rows get 0, which is the
-- honest starting state: we have never counted before.
ALTER TABLE "AdminUser" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;

-- Set when the counter trips. Checked BEFORE bcrypt so a locked account costs
-- an attacker one indexed lookup instead of a ~250 ms hash — which also means
-- a flood against a locked account cannot be used to starve the box of CPU.
ALTER TABLE "AdminUser" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- ─── AdminSession ───────────────────────────────────────────────────────────
--
-- Deliberately the same shape as the member "Session" table, down to the
-- column names, so there is ONE session design in this system to reason about.
-- Rotating refresh token, sha256 stored and never the token, a short grace
-- window on the previous hash.
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    -- sha256 hex of the CURRENT refresh token.
    "refreshHash" TEXT NOT NULL,
    -- What we rotated away from, honoured for ~30 seconds.
    --
    -- ⚠️ WITHOUT THIS, TWO DESK TABS SIGN THE OPERATOR OUT. Both wake holding
    -- the same refresh token and both refresh; one rotates, the other presents
    -- a hash matching nothing, which the replay rule then reads as a stolen
    -- token and revokes the session the winning tab is using.
    "prevRefreshHash" TEXT,
    "prevRefreshExpiresAt" TIMESTAMP(3),
    -- ⚠️ TRUE = OPENED WITH A RECOVERY CODE = MAY NOT WRITE, whatever role the
    -- admin holds. A recovery code proves possession of a piece of paper, not
    -- of the phone. Read-only until TOTP is re-enrolled. The guard reads this
    -- column, not the token's `amr` claim, so revoking the restriction takes
    -- effect on the next request rather than on the next token.
    "recoveryOnly" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    -- Kept, never deleted: "which devices were signed in when that command was
    -- approved" has to stay answerable after the fact.
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- UNIQUE, not just indexed. Two rows holding one refresh hash would make
-- rotation ambiguous and the replay rule unenforceable.
CREATE UNIQUE INDEX "AdminSession_refreshHash_key" ON "AdminSession"("refreshHash");

-- The listing query ("my open sessions") and the revoke-all sweep.
CREATE INDEX "AdminSession_adminUserId_revokedAt_idx" ON "AdminSession"("adminUserId", "revokedAt");
-- The expiry sweep.
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- ⚠️ ON DELETE CASCADE. Deleting an AdminUser must not leave sessions behind
-- that still resolve — the guard looks the session up by id, and an orphan row
-- whose admin is gone is a token that outlives the account.
ALTER TABLE "AdminSession"
  ADD CONSTRAINT "AdminSession_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── AdminRecoveryCode ──────────────────────────────────────────────────────
--
-- ⚠️ A TABLE RATHER THAN A `TEXT[]` COLUMN ON AdminUser, BECAUSE OF THE RACE.
-- Spending a code must be provably single-use. As rows that is one guarded
-- DELETE whose affected-row count is the proof. As an array it is a
-- read-modify-write: two requests present the same code, both read ten hashes,
-- both write nine back, and the second write resurrects the code the first
-- just spent. Postgres cannot catch that for us.
--
-- ⚠️ THERE IS NO EMAIL OR SMS RECOVERY AND THERE MUST NOT BE. SIM-swap fraud
-- is endemic in South Africa; a recovery path that terminates at a phone
-- number is one an attacker can buy at a network shop counter, and this
-- account approves commands that run on the production box. The two backstops
-- are these ten codes and a shell on the box itself.
CREATE TABLE "AdminRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    -- bcrypt cost 12, matching the member password cost. A recovery code IS a
    -- password that skips the second factor, so it gets the same work factor.
    --
    -- ⚠️ Consumption DELETES this row rather than stamping a `consumedAt`.
    -- A spent hash left in the table is an offline-grindable secret with no
    -- remaining purpose; the audit row records that a code was used.
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminRecoveryCode_adminUserId_idx" ON "AdminRecoveryCode"("adminUserId");

ALTER TABLE "AdminRecoveryCode"
  ADD CONSTRAINT "AdminRecoveryCode_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
