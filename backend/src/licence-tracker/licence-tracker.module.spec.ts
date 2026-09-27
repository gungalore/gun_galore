import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionService } from '../auth/session.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LicenceTrackerModule } from './licence-tracker.module';
import { LicenceTrackerService } from './licence-tracker.service';
import { LicenceTrackerSweepService } from './licence-tracker-sweep.service';

// ⚠️ THIS SPEC EXISTS BECAUSE THE FIRST NEWS DEPLOY CRASH-LOOPED THE BACKEND.
// The admin controller takes AdminJwtGuard, which injects JwtService; the
// module registered neither JwtModule nor the guard, tsc was clean, every
// unit spec passed, and pm2 restarted the API 54 times before anyone saw it
// (2026-09-07 11:15). Nest resolves a controller's guards inside the
// controller's own module, so a global module elsewhere does not help. This
// compiles the module the way the app does — with only the GLOBAL providers
// stubbed — so a missing local dependency fails here, not on the box.
//
// ⚠️ THE GUARDS THEMSELVES ARE NOT STUBBED, ON PURPOSE. Nest instantiates a
// controller's @UseGuards classes inside the host module, so AuthGuard and
// AdminJwtGuard are built for real here exactly as they are in the app; only
// their GLOBAL dependencies (SessionService, and the tracker's own
// NotificationsService/SettingsService reads) are stood in for. That is what
// makes a missing LOCAL dependency — the AdminJwtGuard/JwtService pair that
// took production down — fail in this spec.
@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
    { provide: SettingsService, useValue: {} },
  ],
  exports: [SessionService, NotificationsService, SettingsService],
})
class StubGlobalsModule {}

describe('LicenceTrackerModule', () => {
  it('boots with its controllers and guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, LicenceTrackerModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(mod.get(LicenceTrackerService)).toBeInstanceOf(LicenceTrackerService);
    expect(mod.get(LicenceTrackerSweepService)).toBeInstanceOf(
      LicenceTrackerSweepService,
    );
    await mod.close();
  });
});
