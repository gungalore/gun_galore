import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { InsightsDigestService } from './insights-digest.service';
import { AdminCommandCenterService } from './admin-command-center.service';
import { AdminTrustSafetyService } from './admin-trust-safety.service';
import { AdminHealthService } from './admin-health.service';
import { AdminCreditsService } from './admin-credits.service';
import { AdminDealersService } from './admin-dealers.service';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminCategoryAttributesService } from './admin-category-attributes.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminBroadcastService } from './admin-broadcast.service';
import {
  AdminAuthController,
  AdminAlertsController,
  AdminListingsController,
  AdminUsersController,
  AdminTransactionsController,
  AdminOrdersController,
  AdminAdminsController,
  AdminAuditController,
  AdminAnalyticsController,
  AdminCommandCenterController,
  AdminSearchController,
  AdminTrustSafetyController,
  AdminHealthController,
  HealthPingController,
  AdminCreditsController,
  AdminDealersController,
  AdminCategoriesController,
  AdminCategoryAttributesController,
  AdminSettingsController,
  AdminBroadcastController,
} from './admin.controller';
import { AdminSwapsController } from './admin-swaps.controller';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { ShippingModule } from '../shipping/shipping.module';
import { SwapsModule } from '../swaps/swaps.module';

@Module({
  // ListingsModule so reviewListing can re-index the listing in
  // Meilisearch after the admin approve/reject decision; PaymentsModule
  // so the admin tx dossier controller can call
  // DealerVerificationService.adminOverride; ZohoBooksModule for the
  // Credit Note posted from refundTransaction. (KycModule was only here
  // for the removed AdminKycController.)
  imports: [
    JwtModule.register({}),
    ListingsModule,
    PaymentsModule,
    ZohoBooksModule,
    SwapsModule, // AdminSwapsController → SwapFundingService (force-complete / unwind)
    ShippingModule, // AdminTransactionsController → ShippingService (record a failed shipment)
  ],
  providers: [
    AdminAuthService,
    AdminService,
    // The KYC dossier reads the identity document and selfie out of the
    // encrypted store — they came off a public CDN and an authenticated read
    // is now the only way to see one.
    SecureFileStorageService,
    AdminAuditService,
    AdminAnalyticsService,
    InsightsDigestService,
    AdminCommandCenterService,
    AdminTrustSafetyService,
    AdminHealthService,
    AdminCreditsService,
    AdminDealersService,
    AdminCategoriesService,
    AdminCategoryAttributesService,
    AdminSettingsService,
    AdminBroadcastService,
    AdminJwtGuard,
    SuperadminGuard,
  ],
  controllers: [
    AdminAuthController,
    AdminAlertsController,
    AdminListingsController,
    AdminUsersController,
    AdminTransactionsController,
    AdminOrdersController,
    AdminAdminsController,
    AdminAuditController,
    AdminAnalyticsController,
    AdminCommandCenterController,
    AdminSearchController,
    AdminTrustSafetyController,
    AdminHealthController,
    HealthPingController,
    AdminCreditsController,
    AdminDealersController,
    AdminCategoriesController,
    AdminCategoryAttributesController,
    AdminSettingsController,
    AdminBroadcastController,
    AdminSwapsController,
  ],
  // Export AdminCreditsService so TasksModule's pollCreditBalances
  // cron can inject it without us having to declare the service in
  // two places (which would create two instances + risk drift).
  // AdminHealthService is exported for the cron watchdog (TasksService
  // reuses cronStatuses() to detect stale/wedged crons).
  exports: [AdminCreditsService, AdminHealthService],
})
export class AdminModule {}
