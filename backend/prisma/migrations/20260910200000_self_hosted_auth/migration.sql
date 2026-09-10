-- Self-hosted auth: Clerk out, our own sessions in, Didit for verification.
--
-- ⚠️ THIS MIGRATION DELETES EVERY USER AND EVERYTHING THAT CASCADES FROM ONE.
-- That is the operator's explicit instruction (2026-09-10) and it is what makes
-- the rest of this file possible: `passwordHash`, `username` and
-- `usernameLower` are all NOT NULL with no sensible default, and there is no
-- password to back-fill for an account created against a hosted identity
-- provider. Production held two users, two listings and zero transactions.
--
-- ⚠️ IT DOES NOT REMOVE THE FILES THOSE USERS OWNED. Encrypted identity
-- documents and selfies live on disk under SECURE_UPLOAD_DIR, outside the
-- database, and a Prisma cascade cannot reach the filesystem. After running
-- this, clear that tree by hand or the bytes outlive every row that pointed at
-- them.

-- ─── the wipe ───────────────────────────────────────────────────────────────
--
-- ⚠️ TRUNCATE ... CASCADE, NOT A DELETE, AND DELIBERATELY SO. Sixteen relations
-- point at User WITHOUT `onDelete: Cascade`, so a plain DELETE is refused by
-- the first listing, offer, bid, rating or order that exists. A hand-ordered
-- delete list would work today and break the moment somebody adds a foreign
-- key — TRUNCATE CASCADE asks Postgres to follow the references itself.
--
-- WHAT THIS TAKES: every row that references a member, directly or
-- transitively — listings, transactions, orders, offers, bids, ratings,
-- questions, wishlists, saved searches, notifications, motivations,
-- credentials, benches, login events, action tokens, complaints and support
-- tickets.
--
-- WHAT SURVIVES, because none of it references User: AdminUser (its `userId`
-- is a plain column with NO foreign key, so the operator's own admin login is
-- untouched), Category and the whole taxonomy, Dealer, Setting, AdminAlert,
-- the reloading manual corpus, the Bench load/cartridge/powder reference data,
-- crime stats and news clippings.
TRUNCATE TABLE "User" CASCADE;

-- ─── User ───────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "User_clerkId_key";
ALTER TABLE "User" DROP COLUMN "clerkId";

-- Verified by Didit's email OTP at sign-up. Login refuses until it is set.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
-- bcrypt, cost 12. The only credential a member has.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL;

-- Username is the ONLY identity shown to other members, so it is required —
-- and usernameLower is what the unique index is really for: without it,
-- "Gerhard" and "gerhard" are two accounts and impersonation is a rename away.
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ADD COLUMN "usernameLower" TEXT NOT NULL;
CREATE UNIQUE INDEX "User_usernameLower_key" ON "User"("usernameLower");

-- Didit issues, holds and counts the phone OTP now. A code we do not generate
-- is a code we must not store a hash of.
ALTER TABLE "User" DROP COLUMN "phoneOtpHash";
ALTER TABLE "User" DROP COLUMN "phoneOtpExpiresAt";
ALTER TABLE "User" DROP COLUMN "phoneOtpAttempts";

-- VerifyNow is gone; so are the two columns that only ever held its answers.
ALTER TABLE "User" DROP COLUMN "kycVerifyNowTransactionId";
ALTER TABLE "User" DROP COLUMN "kycHaCheckJson";

-- ⚠️ ON THE ROW, NOT ONLY IN THE THROTTLER. The request throttler is in-memory
-- and every `pm2 reload` clears it, so a deploy would hand an attacker a fresh
-- budget of guesses. This counter survives one.
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- ─── AdminUser ──────────────────────────────────────────────────────────────
-- The optional link to a member row. Renamed only; admins authenticate on
-- their own JWT and always did.
ALTER TABLE "AdminUser" RENAME COLUMN "clerkId" TO "userId";
ALTER INDEX "AdminUser_clerkId_key" RENAME TO "AdminUser_userId_key";

-- ─── the columns that carried a provider subject ────────────────────────────
ALTER TABLE "Message" RENAME COLUMN "senderClerkId" TO "senderId";
ALTER TABLE "SupportTicketReply" RENAME COLUMN "authorClerkId" TO "authorId";

-- UserEvent kept the raw subject beside the resolved userId for hot append
-- paths. There is one identifier now, so the second column can only disagree.
DROP INDEX IF EXISTS "UserEvent_clerkId_createdAt_idx";
ALTER TABLE "UserEvent" DROP COLUMN "clerkId";

ALTER TABLE "LoginEvent" RENAME COLUMN "clerkSessionId" TO "sessionId";
ALTER INDEX "LoginEvent_clerkSessionId_key" RENAME TO "LoginEvent_sessionId_key";

-- ─── Session ────────────────────────────────────────────────────────────────
-- One row per signed-in device. The refresh token itself is NEVER stored —
-- only its sha256 — so a database leak cannot mint a session.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    -- What this session rotated AWAY from, honoured for a few seconds.
    -- ⚠️ Without it, two browser tabs waking together sign the member out: both
    -- present the same refresh cookie, one rotates, and the other's hash then
    -- matches nothing. The grace window is what separates a second tab from an
    -- attacker replaying a stolen token an hour later.
    "prevRefreshHash" TEXT,
    "prevRefreshExpiresAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    -- Set on sign-out, password change, or detected replay. Kept rather than
    -- deleted so "signed out from where" stays answerable.
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_refreshHash_key" ON "Session"("refreshHash");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── DiditVerification ──────────────────────────────────────────────────────
-- The KYC verdict arrives asynchronously by webhook, so unlike the synchronous
-- flow this replaced there has to be somewhere for the provider's session id to
-- live between creating it and hearing back. `status` holds DIDIT's vocabulary
-- verbatim — storing the raw value is what lets an unrecognised status be
-- diagnosed instead of silently swallowed.
CREATE TABLE "DiditVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "diditSessionId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "decision" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiditVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiditVerification_diditSessionId_key" ON "DiditVerification"("diditSessionId");
CREATE INDEX "DiditVerification_userId_createdAt_idx" ON "DiditVerification"("userId", "createdAt");
ALTER TABLE "DiditVerification" ADD CONSTRAINT "DiditVerification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
