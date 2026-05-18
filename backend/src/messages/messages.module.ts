import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { MessagesService } from './messages.service';
import { MessagesController, MessagesMetaController } from './messages.controller';

@Module({
  providers: [ModerationService, MessagesService],
  controllers: [MessagesController, MessagesMetaController],
  exports: [MessagesService],
})
export class MessagesModule {}
