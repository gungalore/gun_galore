import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LlmService } from '../common/llm/llm.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { SettingsService } from '../settings/settings.service';
import { FeedModule } from './feed.module';
import { FeedService } from './feed.service';

// ⚠️ THIS SPEC EXISTS BECAUSE A MISSING LOCAL GUARD DEPENDENCY ONCE
// CRASH-LOOPED THE BACKEND WHILE tsc AND EVERY UNIT SPEC STAYED GREEN
// (2026-09-07). It compiles FeedModule the way the app does, standing in only
// for the GLOBAL providers (the guard itself is built for real). A missing
// local dependency — or a guard that cannot resolve its own deps — fails here.
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: SessionService, useValue: {} },
    { provide: LlmService, useValue: {} },
    { provide: CloudinaryService, useValue: {} },
    { provide: ContactDetailFilterService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
    { provide: SettingsService, useValue: {} },
  ],
  exports: [
    PrismaService,
    SessionService,
    LlmService,
    CloudinaryService,
    ContactDetailFilterService,
    NotificationsService,
    SettingsService,
  ],
})
class StubGlobalsModule {}

describe('FeedModule', () => {
  it('boots with its controllers and guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, FeedModule],
    }).compile();

    expect(mod.get(FeedService)).toBeInstanceOf(FeedService);
    await mod.close();
  });
});
