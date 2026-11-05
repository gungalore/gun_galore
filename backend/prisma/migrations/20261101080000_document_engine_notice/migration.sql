CREATE TABLE "DocumentEngineNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motivationId" TEXT NOT NULL DEFAULT '',
    "action" VARCHAR(32) NOT NULL,
    "outageId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentEngineNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentEngineNotice_userId_motivationId_action_outageId_key"
    ON "DocumentEngineNotice"("userId", "motivationId", "action", "outageId");

CREATE INDEX "DocumentEngineNotice_notifiedAt_idx"
    ON "DocumentEngineNotice"("notifiedAt");
