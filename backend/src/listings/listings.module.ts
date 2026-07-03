import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { FirearmLicenceService } from './firearm-licence.service';
import { PriceEstimateService } from './price-estimate.service';
import { ListingQuestionsService } from './listing-questions.service';
import {
  ListingQuestionsController,
  SellerQuestionsController,
} from './listing-questions.controller';
import { CategoriesModule } from '../categories/categories.module';
import { WishlistAlertsModule } from '../wishlist-alerts/wishlist-alerts.module';

@Module({
  // CategoriesModule exports CategoriesService — used by ListingsService to
  // resolve a category's effective attribute definitions when validating
  // per-listing attribute values (P4.2).
  // WishlistAlertsModule (P5.2) exports WishlistAlertsService — the price-drop
  // fan-out to wishlisters on a seller price cut.
  imports: [CategoriesModule, WishlistAlertsModule],
  controllers: [
    ListingsController,
    ListingQuestionsController,
    SellerQuestionsController,
  ],
  // PriceEstimateService (resale-value estimator) — exported so the Ask GG
  // engine can reach it for the estimateResaleValue chat tool (AskGgModule
  // already imports ListingsModule; no cycle).
  providers: [
    ListingsService,
    ListingQuestionsService,
    FirearmLicenceService,
    PriceEstimateService,
  ],
  exports: [ListingsService, ListingQuestionsService, PriceEstimateService],
})
export class ListingsModule {}
