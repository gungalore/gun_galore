import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AskGgService } from './ask-gg.service';
import { AskGgClaudeService } from './ask-gg-claude.service';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgKbService } from './ask-gg-kb.service';
import { AskGgController } from './ask-gg.controller';
import {
  AskGgKbAdminController,
  AskGgExpertAdminController,
} from './ask-gg-kb-admin.controller';
import { AdminAuditService } from '../admin/admin-audit.service';
import { adminJwtSecret } from '../admin/admin-jwt-secret';
import { ReloadingModule } from '../reloading/reloading.module';
import { BallisticsModule } from '../ballistics/ballistics.module';
import { LoadLabModule } from '../load-lab/load-lab.module';

@Module({
  // ReloadingModule exports ReloadingService so AskGgClaudeService can
  // call searchPages + slicePagesAsPdf when answering reloading
  // questions (Phase D Sprint 2 tool-use loop).
  imports: [
    ReloadingModule,
    BallisticsModule,
    LoadLabModule,
    // For the admin KB-verification controller (uses AdminJwtGuard).
    // Same secret/config as AdminModule — kept local here so we
    // don't create a circular dep importing AdminModule.
    JwtModule.register({
      secret: adminJwtSecret(),
    }),
  ],
  controllers: [
    AskGgController,
    AskGgKbAdminController,
    AskGgExpertAdminController,
  ],
  providers: [
    AskGgService,
    AskGgClaudeService,
    AskGgQuotaService,
    AskGgKbService,
    AdminAuditService,
  ],
  exports: [AskGgService, AskGgKbService],
})
export class AskGgModule {}
