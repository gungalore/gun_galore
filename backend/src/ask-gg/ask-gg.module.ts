import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AskGgService } from './ask-gg.service';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { AskGgClaudeService } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgKbService } from './ask-gg-kb.service';
import { AskGgController, AskGgPublicController } from './ask-gg.controller';
import {
  AskGgKbAdminController,
  AskGgExpertAdminController,
} from './ask-gg-kb-admin.controller';
import { AskGgGuideAdminController } from './ask-gg-guide-admin.controller';
import { AdminAuditService } from '../admin/admin-audit.service';
import { adminJwtSecret } from '../admin/admin-jwt-secret';
import { ReloadingModule } from '../reloading/reloading.module';
import { BallisticsModule } from '../ballistics/ballistics.module';
import { LoadLabModule } from '../load-lab/load-lab.module';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';
import { OffersModule } from '../offers/offers.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AskGgPlatformToolsService } from './ask-gg-platform-tools.service';
import { AskGgContextService } from './ask-gg-context.service';
import { AskGgAccountToolsService } from './ask-gg-account-tools.service';
import { AskGgLaneService } from './ask-gg-lane.service';
import { AskGgGuideService } from './ask-gg-guide.service';

@Module({
  // ReloadingModule exports ReloadingService so AskGgClaudeService can
  // call searchPages + slicePagesAsPdf when answering reloading
  // questions (Phase D Sprint 2 tool-use loop).
  // ListingsModule (P2.2) exports ListingsService for the marketplace
  // lever — searchMarketplace (browse) + getComplements (crossSell).
  // ListingsModule has no imports of its own, so no cycle.
  // PaymentsModule (Ask GG Everywhere) exports FeeCalculator for the
  // computeFees tool — exact same fee engine checkout uses. Payments
  // does not import AskGgModule, so no cycle.
  // W5 account tools: OffersModule/AuctionsModule each export
  // the read service the tools wrap; none of
  // them imports AskGgModule (verified — no cycles). UsersModule is
  // @Global (UsersService + SellerToolsService); orders are read via
  // lean own selects in getOrderStatus, so no OrdersModule needed.
  imports: [
    ReloadingModule,
    BallisticsModule,
    LoadLabModule,
    ListingsModule,
    PaymentsModule,
    OffersModule,
    AuctionsModule,
    // For the admin KB-verification controller (uses AdminJwtGuard).
    // Same secret/config as AdminModule — kept local here so we
    // don't create a circular dep importing AdminModule.
    JwtModule.register({
      secret: adminJwtSecret(),
    }),
  ],
  controllers: [
    AskGgController,
    AskGgPublicController,
    AskGgKbAdminController,
    AskGgExpertAdminController,
    AskGgGuideAdminController,
  ],
  providers: [
    AskGgService,
    AskGgClaudeService,
    AskGgQuotaService,
    AskGgKbService,
    AskGgPlatformToolsService,
    AskGgContextService,
    AskGgAccountToolsService,
    AskGgLaneService,
    AskGgGuideService,
    AdminAuditService,
    // Provided for the public /ask-gg/public/guide route's OptionalClerkGuard.
    OptionalClerkGuard,
  ],
  exports: [AskGgService, AskGgKbService],
})
export class AskGgModule {}
