import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';

@Controller('transactions/:transactionId/rating')
@UseGuards(ClerkGuard)
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  create(
    @Param('transactionId') transactionId: string,
    @CurrentUser() clerkId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratingsService.create(transactionId, clerkId, dto);
  }
}

@Controller('ratings')
@UseGuards(ClerkGuard)
export class RatingsDashboardController {
  constructor(private readonly ratingsService: RatingsService) {}

  // Seller's private trust dashboard
  @Get('dashboard')
  dashboard(@CurrentUser() clerkId: string) {
    return this.ratingsService.getTrustDashboard(clerkId);
  }

  // Seller's public ratings (used on listing pages)
  @Get('seller/:clerkId')
  forSeller(@Param('clerkId') clerkId: string) {
    return this.ratingsService.findForSeller(clerkId);
  }
}
