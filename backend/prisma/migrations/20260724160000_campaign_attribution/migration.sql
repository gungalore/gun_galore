-- Campaign conversion attribution. The campaigns page could only show banner
-- impressions ("hits"), so a paid SMS blast could not be judged on whether
-- anyone actually SIGNED UP — the only question that matters when you pay per
-- message. Nullable + first-touch: set once at provisioning, never overwritten.
ALTER TABLE "User" ADD COLUMN "campaignKey" TEXT;

-- Rollup index for the groupBy on the admin campaigns page.
CREATE INDEX "User_campaignKey_idx" ON "User"("campaignKey");
