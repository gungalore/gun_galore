import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsFeedController } from './notifications-feed.controller';
import { PushModule } from '../push/push.module';
import { Saps534Service } from '../payments/saps534.service';

@Global()
@Module({
  imports: [PushModule],
  controllers: [NotificationsFeedController],
  // Saps534Service has no Nest dependencies (it loads a static asset +
  // pdf-lib), so we register it here and inject it into
  // NotificationsService directly. Registering it in this @Global()
  // module also avoids a circular import with PaymentsModule (which
  // depends on NotificationsModule, not the other way around).
  providers: [NotificationsService, Saps534Service],
  exports: [NotificationsService, Saps534Service],
})
export class NotificationsModule {}
