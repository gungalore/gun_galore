import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { FirearmLicenceService } from './firearm-licence.service';
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
  providers: [ListingsService, ListingQuestionsService, FirearmLicenceService],
  exports: [ListingsService, ListingQuestionsService],
})
export class ListingsModule {}
