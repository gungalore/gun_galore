import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SwapFundingService } from './swap-funding.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SwapDeliveryDto } from './dto/swap-delivery.dto';

@Controller('swaps')
@UseGuards(ClerkGuard)
export class SwapFundingController {
  constructor(private readonly funding: SwapFundingService) {}

  // The caller's in-flight swaps (drives /my/swaps).
  @Get('mine')
  mine(@CurrentUser() clerkId: string) {
    return this.funding.getMySwaps(clerkId);
  }

  @Get(':id/funding')
  state(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.funding.getFundingState(clerkId, id);
  }

  // Each party submits the delivery address for the leg they receive. Once
  // both are in, funding is quoted + set up; returns the caller's state.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post(':id/delivery-address')
  submitAddress(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: SwapDeliveryDto,
  ) {
    return this.funding.submitDeliveryAddress(clerkId, id, dto);
  }

  // Retry the quote/setup if a live carrier rate failed the first time.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/funding/retry')
  async retry(@CurrentUser() clerkId: string, @Param('id') id: string) {
    // Authorise the caller as a party first (getFundingState throws otherwise).
    await this.funding.getFundingState(clerkId, id);
    await this.funding.ensureFundingSetUp(id);
    return this.funding.getFundingState(clerkId, id);
  }

  // A participant flags a problem with the item they received (S5). Stops the
  // auto-release; sends the swap to admin review. Held funds stay protected.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/dispute')
  dispute(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.funding.raiseSwapDispute(clerkId, id, body?.reason ?? '');
  }
}
