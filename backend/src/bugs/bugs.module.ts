import { Module } from '@nestjs/common';
import { BugsController } from './bugs.controller';
import { BugsService } from './bugs.service';

// Member-submitted bug reports → operator email (support mailbox).
// NotificationsService is @Global, so it injects without an explicit import.
@Module({
  controllers: [BugsController],
  providers: [BugsService],
})
export class BugsModule {}
