-- Insights / behavioural analytics. Additive: one nullable column on User
-- + four new tables (raw events, login sessions, two rollups).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clerkId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "listingId" TEXT,
    "query" TEXT,
    "resultCount" INTEGER,
    "amountCents" INTEGER,
    "path" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clerkSessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUserStats" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "logins" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "listingViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "offers" INTEGER NOT NULL DEFAULT 0,
    "bids" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyUserStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyPlatformStats" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HourlyPlatformStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserEvent_createdAt_idx" ON "UserEvent"("createdAt");
CREATE INDEX "UserEvent_userId_createdAt_idx" ON "UserEvent"("userId", "createdAt");
CREATE INDEX "UserEvent_eventType_createdAt_idx" ON "UserEvent"("eventType", "createdAt");
CREATE INDEX "UserEvent_clerkId_createdAt_idx" ON "UserEvent"("clerkId", "createdAt");
CREATE UNIQUE INDEX "LoginEvent_clerkSessionId_key" ON "LoginEvent"("clerkSessionId");
CREATE INDEX "LoginEvent_userId_startedAt_idx" ON "LoginEvent"("userId", "startedAt");
CREATE UNIQUE INDEX "DailyUserStats_day_userId_key" ON "DailyUserStats"("day", "userId");
CREATE INDEX "DailyUserStats_day_idx" ON "DailyUserStats"("day");
CREATE INDEX "DailyUserStats_userId_day_idx" ON "DailyUserStats"("userId", "day");
CREATE UNIQUE INDEX "HourlyPlatformStats_hour_eventType_key" ON "HourlyPlatformStats"("hour", "eventType");
CREATE INDEX "HourlyPlatformStats_hour_idx" ON "HourlyPlatformStats"("hour");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
