import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AuthGuard } from '../auth/auth.guard';
import { FeedAdminController } from './feed-admin.controller';
import { FeedAdsService } from './feed-ads.service';
import { FeedController } from './feed.controller';
import { FeedAwardsService } from './feed-awards.service';
import { FeedModerationService } from './feed-moderation.service';
import { FeedService } from './feed.service';

// ⚠️ GUARD DEPENDENCIES ARE PROVIDED LOCALLY. Nest resolves a controller's
// @UseGuards classes inside the controller's OWN module; a guard registered
// globally elsewhere does not cover it. AuthGuard injects SessionService and
// AdminJwtGuard injects JwtService — hence JwtModule below and the local
// providers. feed.module.spec.ts boots this the way the app does so a missing
// local dependency fails in CI, not by crash-looping production (2026-09-07).
@Module({
  imports: [JwtModule.register({})],
  controllers: [FeedController, FeedAdminController],
  providers: [
    FeedService,
    FeedModerationService,
    FeedAwardsService,
    FeedAdsService,
    AuthGuard,
    AdminJwtGuard,
  ],
  exports: [FeedService, FeedModerationService, FeedAwardsService, FeedAdsService],
})
export class FeedModule {}
