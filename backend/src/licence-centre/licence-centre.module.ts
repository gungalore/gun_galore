import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LicenceCentreController } from './licence-centre.controller';
import { LicenceCentreScanController } from './licence-centre-scan.controller';
import { ScanHandoffGuard } from '../auth/scan-handoff.guard';
import { LicenceCentreAdminController } from './licence-centre-admin.controller';
import { LicenceCentreService } from './licence-centre.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { LicenceCentreTextractService } from './licence-centre-textract.service';
import { KycIdAdoptionService } from './kyc-id-adoption.service';
import { LicenceCentreRemindersService } from './licence-centre-reminders.service';
import { LicenceCentreRetentionService } from './licence-centre-retention.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { MotivationsModule } from '../motivations/motivations.module';

// ⚠️ JwtModule.register({}) + AdminJwtGuard in providers are BOTH required
// because this module hosts an AdminJwtGuard controller. Omit either and the
// backend crash-loops at boot while tsc passes clean.
//
// SecureFileStorageService is provided LOCALLY — it is not @Global, and
// MotivationsModule deliberately does not export it.
//
// PrismaService, SettingsService and NotificationsService are @Global;
// importing their modules here would risk an import cycle for nothing.
//
// ScheduleModule is NOT imported: forRoot() is registered once, in
// tasks.module.ts, and registers the scheduler globally.
@Module({
  // MotivationsModule for the renewal one-tap. One-way: nothing in
  // motivations/ reaches back here, so there is no cycle — and a spec asserts
  // it stays that way.
  imports: [JwtModule.register({}), MotivationsModule],
  controllers: [
    LicenceCentreController,
    LicenceCentreScanController,
    LicenceCentreAdminController,
  ],
  providers: [
    // Provided, not merely referenced — see the note in motivations.module.ts.
    ScanHandoffGuard,
    LicenceCentreService,
    LicenceCentreQuotaService,
    LicenceCentreExtractService,
    LicenceCentreTextractService,
    KycIdAdoptionService,
    LicenceCentreRemindersService,
    LicenceCentreRetentionService,
    SecureFileStorageService,
    AdminJwtGuard,
  ],
  // Exported only so the Clerk user.deleted handler can remove the encrypted
  // files before the cascade takes the rows that point at them.
  exports: [LicenceCentreRetentionService],
})
export class LicenceCentreModule {}
