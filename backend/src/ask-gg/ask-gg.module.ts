import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AskGgService } from './ask-gg.service';
import { AskGgClaudeService } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgKbService } from './ask-gg-kb.service';
import { AskGgController, AskGgPublicController } from './ask-gg.controller';
import {
  AskGgKbAdminController,
  AskGgExpertAdminController,
} from './ask-gg-kb-admin.controller';
import { AdminAuditService } from '../admin/admin-audit.service';
import { adminJwtSecret } from '../admin/admin-jwt-secret';
import { ReloadingModule } from '../reloading/reloading.module';
import { BallisticsModule } from '../ballistics/ballistics.module';
import { LoadLabModule } from '../load-lab/load-lab.module';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';
import { AskGgPlatformToolsService } from './ask-gg-platform-tools.service';

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
  imports: [
    ReloadingModule,
    BallisticsModule,
    LoadLabModule,
    ListingsModule,
    PaymentsModule,
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
  ],
  providers: [
    AskGgService,
    AskGgClaudeService,
    AskGgQuotaService,
    AskGgKbService,
    AskGgPlatformToolsService,
    AdminAuditService,
  ],
  exports: [AskGgService, AskGgKbService],
})
export class AskGgModule {}
