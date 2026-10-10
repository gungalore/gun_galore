import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

// Depends only on @Global providers (Prisma, ContactDetailFilterService via
// ModerationModule, LlmService via LlmModule, NotificationsService via
// NotificationsModule), so no imports are needed. Mounts a guarded controller
// → messages.module.spec.ts is the boot spec that proves the guard resolves.
@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
