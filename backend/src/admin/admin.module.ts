import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import {
  AdminAuthController,
  AdminStatsController,
  AdminListingsController,
  AdminUsersController,
  AdminTransactionsController,
} from './admin.controller';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SuperadminGuard } from './guards/superadmin.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [AdminAuthService, AdminService, AdminJwtGuard, SuperadminGuard],
  controllers: [
    AdminAuthController,
    AdminStatsController,
    AdminListingsController,
    AdminUsersController,
    AdminTransactionsController,
  ],
})
export class AdminModule {}
