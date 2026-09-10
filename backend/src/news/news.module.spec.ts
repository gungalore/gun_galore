import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsModule } from './news.module';
import { NewsService } from './news.service';

// ⚠️ THIS SPEC EXISTS BECAUSE THE FIRST DEPLOY CRASH-LOOPED THE BACKEND.
// The admin controller takes AdminJwtGuard, which injects JwtService; the
// module registered neither JwtModule nor the guard, tsc was clean, every
// unit spec passed, and pm2 restarted the API 54 times before anyone saw it
// (2026-09-07 11:15). Nest resolves a controller's guards inside the
// controller's own module, so a global module elsewhere does not help. This
// compiles the module the way the app does — with only the GLOBAL providers
// stubbed — so a missing local dependency fails here, not on the box.
// ⚠️ THE GUARD ITSELF IS NOT STUBBED, ON PURPOSE. Nest instantiates a
// controller's @UseGuards classes inside the host module, so AuthGuard is
// built for real here exactly as it is in the app; only its GLOBAL
// dependencies (SessionService) are stood in for. That is what
// makes a missing LOCAL dependency — the AdminJwtGuard/JwtService pair that
// took production down — fail in this spec.
@Global()
@Module({
  providers: [{ provide: SessionService, useValue: {} }],
  exports: [SessionService],
})
class StubGlobalsModule {}

describe('NewsModule', () => {
  it('boots with its controllers and guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, NewsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(mod.get(NewsService)).toBeInstanceOf(NewsService);
    await mod.close();
  });
});
