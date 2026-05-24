import { Module } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import {
  RatingsController,
  RatingsDashboardController,
  RatingsPublicController,
} from './ratings.controller';

@Module({
  providers: [RatingsService],
  controllers: [
    RatingsController,
    RatingsDashboardController,
    RatingsPublicController,
  ],
  exports: [RatingsService],
})
export class RatingsModule {}
