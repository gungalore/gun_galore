-- Claude-vision KYC flow (kyc_claude_flow_enabled): UNDER_REVIEW status +
-- per-user document/selfie/findings columns. Purely additive DDL — no row
-- writes (Postgres forbids using a value added by ALTER TYPE ... ADD VALUE
-- inside the same transaction, so this migration must stay write-free).

ALTER TYPE "KycStatus" ADD VALUE 'UNDER_REVIEW';

ALTER TABLE "User" ADD COLUMN "dateOfBirth" TEXT;
ALTER TABLE "User" ADD COLUMN "kycIdDocumentUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "kycSelfieUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "kycClaudeFindings" JSONB;
ALTER TABLE "User" ADD COLUMN "kycHaCheckJson" JSONB;
ALTER TABLE "User" ADD COLUMN "kycMethod" TEXT;
ALTER TABLE "User" ADD COLUMN "kycTier" TEXT;
ALTER TABLE "User" ADD COLUMN "kycReviewedById" TEXT;
ALTER TABLE "User" ADD COLUMN "kycReviewedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "kycReviewNote" TEXT;
