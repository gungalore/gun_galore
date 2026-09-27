import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenceTrackerAdminController } from './licence-tracker-admin.controller';
import { LicenceTrackerController } from './licence-tracker.controller';
import { LicenceTrackerService } from './licence-tracker.service';
import { LicenceTrackerSweepService } from './licence-tracker-sweep.service';
import { SapsEnquiryClient } from './saps-enquiry.client';

/**
 * The SAPS application tracker.
 *
 * ⚠️ JwtModule.register({}) AND AdminJwtGuard IN PROVIDERS, from day one.
 * `AdminJwtGuard` injects JwtService, PrismaService and Reflector, and Nest
 * resolves a controller's guards inside the controller's OWN module — a
 * guard registered globally elsewhere does not cover it. CrimeStatsModule
 * shipped without these and crash-looped the backend for four minutes on
 * 2026-09-07 while `tsc` and every unit test were green. The boot spec next
 * to this file compiles the module the way the app does.
 *
 * ⚠️ PrismaModule is imported even though it is itself @Global, for the same
 * reason NewsModule imports it: the boot spec compiles THIS module alone, and
 * a dependency that only resolves because some other module happens to be
 * loaded first is exactly the failure that spec exists to catch.
 *
 * Not @Global: nothing outside this feature reads a tracked application.
 */
@Module({
  imports: [JwtModule.register({}), PrismaModule],
  controllers: [LicenceTrackerController, LicenceTrackerAdminController],
  providers: [
    LicenceTrackerService,
    LicenceTrackerSweepService,
    SapsEnquiryClient,
    AdminJwtGuard,
  ],
  exports: [LicenceTrackerService],
})
export class LicenceTrackerModule {}
