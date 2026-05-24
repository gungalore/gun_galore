import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsFeedController } from './notifications-feed.controller';

@Global()
@Module({
  controllers: [NotificationsFeedController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
