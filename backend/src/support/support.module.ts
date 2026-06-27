import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportAdminController } from './support-admin.controller';

// Support ticketing (Phase 7 P7.2). PrismaService + NotificationsService
// are both provided by @Global() modules, so no imports are needed here.
@Module({
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
})
export class SupportModule {}
