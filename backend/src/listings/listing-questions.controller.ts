import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListingQuestionsService } from './listing-questions.service';

@Controller('listings')
export class ListingQuestionsController {
  constructor(private readonly qa: ListingQuestionsService) {}

  // Public — the Q&A panel on /listings/[id] hits this on render.
  // No auth: listings are public, the answered Qs are part of the
  // listing's public surface area.
  // SkipThrottle: SSR call from same IP would otherwise trip the bucket.
  @Get(':id/questions')
  @SkipThrottle()
  list(@Param('id') listingId: string) {
    return this.qa.listPublic(listingId);
  }

  // Buyer asks a question. Body: { question: string }.
  // Tight throttle (5/min/user) — every ask runs through TWO Claude
  // calls (moderation + dedup) so unbounded asks burn API cost fast.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/questions')
  @UseGuards(AuthGuard)
  ask(
    @Param('id') listingId: string,
    @CurrentUser() userId: string,
    @Body() body: { question: string },
  ) {
    return this.qa.ask(listingId, userId, body?.question ?? '');
  }

  // Public — anyone signed-in or otherwise can flag an answer.
  // (One-per-row dedup TBD; reportedCount is the signal admin acts on.)
  @Post('questions/:questionId/report')
  report(@Param('questionId') questionId: string) {
    return this.qa.report(questionId);
  }
}

// Seller-side controller — scoped under a separate route so the
// public Q&A endpoints don't accidentally inherit AuthGuard / class
// decorators on the public side.
@Controller('me/questions')
export class SellerQuestionsController {
  constructor(private readonly qa: ListingQuestionsService) {}

  // List all Qs on the seller's listings. Powers the dashboard card.
  @Get()
  @UseGuards(AuthGuard)
  list(@CurrentUser() userId: string) {
    return this.qa.listForSeller(userId);
  }

  // Seller answers a pending question. Body: { answer: string }.
  @Post(':questionId/answer')
  @UseGuards(AuthGuard)
  answer(
    @Param('questionId') questionId: string,
    @CurrentUser() userId: string,
    @Body() body: { answer: string },
  ) {
    return this.qa.answer(questionId, userId, body?.answer ?? '');
  }

  // Seller flags an AI auto-answer as wrong. Invalidates the source
  // Q so the AI can't re-use it, resets this row to AWAITING_SELLER_ANSWER.
  @Post(':questionId/flag-auto-answer')
  @UseGuards(AuthGuard)
  flagAutoAnswer(
    @Param('questionId') questionId: string,
    @CurrentUser() userId: string,
  ) {
    return this.qa.flagAutoAnswer(questionId, userId);
  }
}
