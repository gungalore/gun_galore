import { Module } from '@nestjs/common';
import { BugsController } from './bugs.controller';
import { BugsService } from './bugs.service';
import { MotivationActivityModule } from '../motivations/motivation-activity.module';

// Member-submitted bug reports → operator email (support mailbox).
// NotificationsService is @Global, so it injects without an explicit import.
//
// ⚠️ MotivationActivityModule IS IMPORTED FOR ONE READ. A report filed from the
// licence-centre page has to arrive with the member's last activity steps
// attached, or support has a description and nothing to match it against. The
// module is deliberately tiny — importing MotivationsModule instead dragged the
// whole writer into this boot and into its spec.
@Module({
  imports: [MotivationActivityModule],
  controllers: [BugsController],
  providers: [BugsService],
})
export class BugsModule {}
