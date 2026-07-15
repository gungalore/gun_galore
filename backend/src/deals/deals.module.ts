import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DealsService } from './deals.service';
import { DealsAdminController } from './deals-admin.controller';
import { DealsPublicController } from './deals-public.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminAuditService } from '../admin/admin-audit.service';

// Daily Deals (DD-1). Self-contained module (Pattern B, mirrors
// FeaturedModule): JwtModule for the AdminJwtGuard on the admin
// controller; AdminAuditService provided locally (it only needs the
// global PrismaService). PrismaService, CloudinaryService, SettingsService
// and ReferenceNumberService all come from their @Global() modules.
@Module({
  imports: [JwtModule.register({})],
  // DealsPublicController is unguarded (public storefront reads); its methods
  // gate internally on FLAGS.dealsEnabled so the surface ships inert (DD-3).
  controllers: [DealsAdminController, DealsPublicController],
  providers: [DealsService, AdminJwtGuard, AdminAuditService],
  exports: [DealsService],
})
export class DealsModule {}
