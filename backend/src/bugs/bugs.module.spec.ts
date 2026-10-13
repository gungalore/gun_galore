import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionService } from '../auth/session.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BugsModule } from './bugs.module';
import { BugsService } from './bugs.service';

// Compiles BugsModule the way the app does, standing in only for the GLOBAL
// providers (the AuthGuard is built for real). A missing guard dependency or
// an unresolved NotificationsService fails here rather than crash-looping the
// backend in production.
@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
  ],
  exports: [SessionService, NotificationsService],
})
class StubGlobalsModule {}

describe('BugsModule', () => {
  it('boots with its controllers and guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, BugsModule],
    }).compile();

    expect(mod.get(BugsService)).toBeInstanceOf(BugsService);
    await mod.close();
  });
});
