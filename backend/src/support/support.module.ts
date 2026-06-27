import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportAdminController } from './support-admin.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// Support ticketing (Phase 7 P7.2). PrismaService + NotificationsService
// are provided by @Global() modules. JwtModule + AdminJwtGuard are needed
// locally because the admin queue controller is @UseGuards(AdminJwtGuard)
// — the guard depends on JwtService, which must resolve within this module
// (same pattern as ManualPaymentsModule).
@Module({
  imports: [JwtModule.register({})],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService, AdminJwtGuard],
})
export class SupportModule {}
