import { Module } from '@nestjs/common';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesController } from './saved-searches.controller';
import { PushModule } from '../push/push.module';

// NotificationsModule is @Global (exports NotificationsService), so it does
// not need importing here. PushModule provides PushService for the explicit
// push in the matcher. Exports the service so TasksService can drive the cron.
@Module({
  imports: [PushModule],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesService],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
