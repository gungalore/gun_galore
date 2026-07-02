import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { FirearmLicenceService } from './firearm-licence.service';
import { ListingQuestionsService } from './listing-questions.service';
import {
  ListingQuestionsController,
  SellerQuestionsController,
} from './listing-questions.controller';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  // CategoriesModule exports CategoriesService — used by ListingsService to
  // resolve a category's effective attribute definitions when validating
  // per-listing attribute values (P4.2).
  imports: [CategoriesModule],
  controllers: [
    ListingsController,
    ListingQuestionsController,
    SellerQuestionsController,
  ],
  providers: [ListingsService, ListingQuestionsService, FirearmLicenceService],
  exports: [ListingsService, ListingQuestionsService],
})
export class ListingsModule {}
