import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LicenceCentreController } from './licence-centre.controller';
import { LicenceCentreAdminController } from './licence-centre-admin.controller';
import { LicenceCentreService } from './licence-centre.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { LicenceCentreRemindersService } from './licence-centre-reminders.service';
import { LicenceCentreRetentionService } from './licence-centre-retention.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

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
  imports: [JwtModule.register({})],
  controllers: [LicenceCentreController, LicenceCentreAdminController],
  providers: [
    LicenceCentreService,
    LicenceCentreQuotaService,
    LicenceCentreExtractService,
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
