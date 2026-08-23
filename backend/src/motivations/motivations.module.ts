import { Module } from '@nestjs/common';
import { MotivationsController } from './motivations.controller';
import { MotivationsScanController } from './motivations-scan.controller';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationsService } from './motivations.service';
import { MotivationPdfService } from './motivation-pdf.service';
import { MotivationRetentionService } from './motivation-retention.service';
import { MotivationExtractService } from './motivation-extract.service';
import { FirearmImageService } from './motivation-firearm-image';
import { MotivationWitnessService } from './motivation-witness.service';
import { MotivationSellerConsentService } from './motivation-seller-consent.service';
import { LicenceCardOcrService } from './licence-card-ocr.service';
import {
  MotivationsConsentController,
  SellerConsentPublicController,
} from './motivations-consent.controller';
import {
  MotivationsWitnessController,
  WitnessPublicController,
} from './motivations-witness.controller';
import { Saps271Service } from './saps271.service';
import { MotivationClaudeService } from './motivation-claude.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { VaultAdoptionService } from './vault-adoption.service';

/**
 * Firearm-licence motivation writer (Phase 1 — LICENCE-SERVICES-AND-FEED.md).
 *
 * Deploys INERT: motivation_writer_enabled defaults to false, and every
 * service method asserts it, so nothing is reachable and no Anthropic spend is
 * possible until an admin flips it with a typed-key confirmation and an audit
 * reason.
 *
 * NO JwtModule / AdminJwtGuard here YET, on purpose. A module hosting an
 * AdminJwtGuard controller MUST import JwtModule.register({}) and provide the
 * guard, or Nest crash-loops at boot while tsc passes clean (see
 * raffle.module.ts, which says so in code). There is no admin controller in
 * this module yet — when one is added, both must be added with it.
 *
 * PrismaService, SettingsService, NotificationsService, ActivityService and
 * ReferenceNumberService are all @Global — importing their modules here would
 * be the wrong instinct and risks an import cycle.
 *
 * SecureFileStorageService is provided locally rather than globally: it is the
 * only consumer today, and keeping it scoped means nothing else can start
 * writing user files into the encrypted store without a deliberate decision.
 */
@Module({
  controllers: [MotivationsController, MotivationsScanController,
    MotivationsWitnessController,
    WitnessPublicController,
    MotivationsConsentController,
    // ⚠️ UNGUARDED BY DESIGN — the seller is a stranger with no account. Every
    // route on it resolves a token to one consent row; see the controller.
    SellerConsentPublicController,
  ],
  providers: [
    // ⚠️ THE GUARD IS PROVIDED, NOT JUST IMPORTED. A controller decorated
    // with a guard whose dependencies this module cannot resolve crash-loops
    // Nest at boot while tsc passes clean — the same trap AdminJwtGuard sets
    // and which is documented above.
    ScanHandoffGuard,
    MotivationsService,
    MotivationQuotaService,
    MotivationPdfService,
    MotivationClaudeService,
    MotivationRetentionService,
    MotivationExtractService,
    Saps271Service,
    FirearmImageService,
    MotivationWitnessService,
    MotivationSellerConsentService,
    LicenceCardOcrService,
    SecureFileStorageService,
    // ⚠️ HERE AND NOT IN LicenceCentreModule, WHERE IT BELONGS BY SUBJECT.
    // That module imports this one for the renewal one-tap and a spec
    // asserts the edge stays one-way, so a service addUpload calls cannot
    // live on the other end of it. It talks to Prisma and the file store
    // directly for the same reason.
    VaultAdoptionService,
  ],
  // MotivationRetentionService is exported so the account-deletion path can
  // remove a user's encrypted documents BEFORE the cascade takes the rows that
  // point at them. SecureFileStorageService is deliberately NOT exported — it
  // stays scoped to this module so nothing else can start writing user files
  // into the encrypted store without a deliberate decision.
  exports: [
    MotivationsService,
    VaultAdoptionService,
    MotivationQuotaService,
    MotivationRetentionService,
  ],
})
export class MotivationsModule {}
