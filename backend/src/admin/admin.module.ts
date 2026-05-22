import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminCommandCenterService } from './admin-command-center.service';
import { AdminTrustSafetyService } from './admin-trust-safety.service';
import { AdminHealthService } from './admin-health.service';
import { AdminDealersService } from './admin-dealers.service';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminBroadcastService } from './admin-broadcast.service';
import {
  AdminAuthController,
  AdminStatsController,
  AdminListingsController,
  AdminUsersController,
  AdminTransactionsController,
  AdminKycController,
  AdminAdminsController,
  AdminAuditController,
  AdminAnalyticsController,
  AdminCommandCenterController,
  AdminSearchController,
  AdminTrustSafetyController,
  AdminHealthController,
  AdminDealersController,
  AdminCategoriesController,
  AdminSettingsController,
  AdminBroadcastController,
} from './admin.controller';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { KycModule } from '../kyc/kyc.module';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // KycModule for AdminKycController; ListingsModule so reviewListing
  // can re-index the listing in Meilisearch after the admin approve/
  // reject decision; PaymentsModule so the admin tx dossier
  // controller can call DealerVerificationService.adminOverride.
  imports: [JwtModule.register({}), KycModule, ListingsModule, PaymentsModule],
  providers: [
    AdminAuthService,
    AdminService,
    AdminAuditService,
    AdminAnalyticsService,
    AdminCommandCenterService,
    AdminTrustSafetyService,
    AdminHealthService,
    AdminDealersService,
    AdminCategoriesService,
    AdminSettingsService,
    AdminBroadcastService,
    AdminJwtGuard,
    SuperadminGuard,
  ],
  controllers: [
    AdminAuthController,
    AdminStatsController,
    AdminListingsController,
    AdminUsersController,
    AdminTransactionsController,
    AdminKycController,
    AdminAdminsController,
    AdminAuditController,
    AdminAnalyticsController,
    AdminCommandCenterController,
    AdminSearchController,
    AdminTrustSafetyController,
    AdminHealthController,
    AdminDealersController,
    AdminCategoriesController,
    AdminSettingsController,
    AdminBroadcastController,
  ],
})
export class AdminModule {}
