import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingQuestionsService } from './listing-questions.service';
import {
  ListingQuestionsController,
  SellerQuestionsController,
} from './listing-questions.controller';

@Module({
  controllers: [
    ListingsController,
    ListingQuestionsController,
    SellerQuestionsController,
  ],
  providers: [ListingsService, ListingQuestionsService],
  exports: [ListingsService, ListingQuestionsService],
})
export class ListingsModule {}
