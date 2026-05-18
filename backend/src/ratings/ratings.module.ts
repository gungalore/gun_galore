import { Module } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { RatingsController, RatingsDashboardController } from './ratings.controller';

@Module({
  providers: [RatingsService],
  controllers: [RatingsController, RatingsDashboardController],
  exports: [RatingsService],
})
export class RatingsModule {}
