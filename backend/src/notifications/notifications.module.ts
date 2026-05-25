import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsFeedController } from './notifications-feed.controller';
import { PushModule } from '../push/push.module';

@Global()
@Module({
  imports: [PushModule],
  controllers: [NotificationsFeedController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
