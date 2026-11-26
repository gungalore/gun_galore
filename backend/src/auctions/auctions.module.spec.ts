import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { ActivityService } from '../activity/activity.service';
import { SearchService } from '../search/search.service';
import { AuctionsModule } from './auctions.module';
import { AuctionsService } from './auctions.service';

// Compiles AuctionsModule the way the app does, standing in only for the
// GLOBAL providers (the guards themselves are built for real). AuctionsController
// mounts OptionalAuthGuard + ContentAccessGuard on its public read, and Nest
// resolves those classes inside the controller's OWN module — a missing/undefined
// provider here is a backend that crash-loops at boot while tsc and every unit
// test stay green (the exact failure bench.module.spec.ts exists for).
@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: {} },
    { provide: PrismaService, useValue: {} },
    // AuctionsService's own @Global collaborators in production.
    { provide: NotificationsService, useValue: {} },
    { provide: ActionTokensService, useValue: {} },
    { provide: ActivityService, useValue: {} },
    { provide: SearchService, useValue: {} },
  ],
  exports: [
    SessionService,
    PrismaService,
    NotificationsService,
    ActionTokensService,
    ActivityService,
    SearchService,
  ],
})
class StubGlobalsModule {}

describe('AuctionsModule', () => {
  it('boots with its controller and both public-read guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, AuctionsModule],
    }).compile();

    expect(mod.get(AuctionsService)).toBeInstanceOf(AuctionsService);
    expect(mod.get(OptionalAuthGuard)).toBeInstanceOf(OptionalAuthGuard);
    expect(mod.get(ContentAccessGuard)).toBeInstanceOf(ContentAccessGuard);
    await mod.close();
  });
});
