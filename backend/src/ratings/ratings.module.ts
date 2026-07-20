import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RatingsService } from './ratings.service';
import {
  RatingsController,
  RatingsAdminController,
  RatingsDashboardController,
  RatingsPublicController,
} from './ratings.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminAuditService } from '../admin/admin-audit.service';

// Pattern B (mirrors DealsModule): JwtModule.register({}) + AdminJwtGuard
// provided locally for the admin controller — a module with an
// AdminJwtGuard controller MUST wire both or the backend crash-loops at
// boot (tsc passes). AdminAuditService only needs the global PrismaService.
// Prisma/Notifications/Moderation come from their @Global() modules.
@Module({
  imports: [JwtModule.register({})],
  providers: [RatingsService, AdminJwtGuard, AdminAuditService],
  controllers: [
    RatingsController,
    RatingsAdminController,
    RatingsDashboardController,
    RatingsPublicController,
  ],
  exports: [RatingsService],
})
export class RatingsModule {}
