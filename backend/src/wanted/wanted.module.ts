import { Module } from '@nestjs/common';
import { WantedController } from './wanted.controller';
import { WantedService } from './wanted.service';

// Wanted ads (demand capture). ContactDetailFilterService and
// NotificationsService come from @Global modules (Moderation /
// Notifications) so no explicit imports are needed here.
@Module({
  controllers: [WantedController],
  providers: [WantedService],
})
export class WantedModule {}
