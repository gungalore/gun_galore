import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

// @Global so ActivityService is injectable in any service (listings, offers,
// auctions, wishlist, orders, users) without per-module imports — same pattern
// as SearchModule. PrismaService (also @Global) is its only dependency.
@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
