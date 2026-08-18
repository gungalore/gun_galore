import { Module } from '@nestjs/common';
import { MotivationsController } from './motivations.controller';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationsService } from './motivations.service';
import { MotivationPdfService } from './motivation-pdf.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

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
  controllers: [MotivationsController],
  providers: [
    MotivationsService,
    MotivationQuotaService,
    MotivationPdfService,
    SecureFileStorageService,
  ],
  exports: [MotivationsService, MotivationQuotaService],
})
export class MotivationsModule {}
