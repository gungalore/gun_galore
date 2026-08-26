import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MarketingService } from './marketing.service';
import { MarketingController } from './marketing.controller';
import { MarketingAdminController } from './marketing-admin.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// SMS campaign welcome banners (Pattern B):
// JwtModule.register({}) + AdminJwtGuard provided locally for the admin
// controller — a module with an AdminJwtGuard controller MUST wire both or
// the backend crash-loops at boot (tsc passes). Prisma comes from @Global.
@Module({
  imports: [JwtModule.register({})],
  controllers: [MarketingController, MarketingAdminController],
  providers: [MarketingService, AdminJwtGuard],
})
export class MarketingModule {}
