import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { LlmService } from '../common/llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagesModule } from './messages.module';
import { MessagesService } from './messages.service';

// ⚠️ Boot spec. MessagesController mounts AuthGuard, and Nest builds a
// controller's guards + its local providers inside the host module. A missing
// LOCAL dependency would only surface on the box (see news.module.spec.ts).
// Every provider MessagesService needs is @Global in the app, so this stands
// them in as globals exactly as the running app resolves them.
@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: {} },
    { provide: PrismaService, useValue: {} },
    { provide: ContactDetailFilterService, useValue: {} },
    { provide: LlmService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
  ],
  exports: [
    SessionService,
    PrismaService,
    ContactDetailFilterService,
    LlmService,
    NotificationsService,
  ],
})
class StubGlobalsModule {}

describe('MessagesModule', () => {
  it('boots with its controller and guard resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, MessagesModule],
    }).compile();

    expect(mod.get(MessagesService)).toBeInstanceOf(MessagesService);
    await mod.close();
  });
});
