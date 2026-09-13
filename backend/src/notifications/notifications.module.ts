import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsFeedController } from './notifications-feed.controller';
import { PushModule } from '../push/push.module';
import { Saps534Service } from '../payments/saps534.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  // WhatsappModule and SettingsModule are both explicit here even though
  // SettingsModule (and PrismaModule/SmsModule, transitively) is @Global —
  // same reasoning as WhatsappModule's own doc comment: a dependency that
  // only resolves because some other module happened to load first is the
  // class of bug the module boot-spec convention exists to catch. This is
  // the `sendSms` fan-out seam's WhatsApp side (`tryWhatsapp`) gaining its
  // two new collaborators.
  imports: [PushModule, WhatsappModule, SettingsModule],
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
