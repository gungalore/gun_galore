import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SwapProposalsService } from './swap-proposals.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateSwapProposalDto } from './dto/create-swap-proposal.dto';
import { CounterSwapDto } from './dto/counter-swap.dto';

@Controller('swaps/proposals')
@UseGuards(ClerkGuard)
export class SwapProposalsController {
  constructor(private readonly swaps: SwapProposalsService) {}

  // Proposer: submit a new swap proposal. Tight limit — each proposal
  // fires a notification (email + SMS) to the owner.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  propose(@CurrentUser() clerkId: string, @Body() dto: CreateSwapProposalDto) {
    return this.swaps.propose(clerkId, dto);
  }

  @Get('mine')
  getMine(@CurrentUser() clerkId: string) {
    return this.swaps.getMine(clerkId);
  }

  @Get('received')
  getReceived(@CurrentUser() clerkId: string) {
    return this.swaps.getReceived(clerkId);
  }

  // SwapPanel driver — proposals on one listing, scoped to the caller.
  @Get('for-listing/:listingId')
  getForListing(
    @CurrentUser() clerkId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.swaps.getForListing(clerkId, listingId);
  }

  // The caller's own SWOP listings they can offer in a swap.
  @Get('offerable')
  getOfferable(
    @CurrentUser() clerkId: string,
    @Query('exclude') exclude?: string,
  ) {
    return this.swaps.getMyOfferableListings(clerkId, exclude);
  }

  @Get(':id')
  getOne(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.getById(clerkId, id);
  }

  // Owner accepts the original proposal.
  @Post(':id/accept')
  accept(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.acceptProposal(clerkId, id);
  }

  // Owner rejects the original proposal.
  @Post(':id/reject')
  reject(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.reject(clerkId, id);
  }

  // Owner counters the cash (once).
  @Post(':id/counter')
  counter(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: CounterSwapDto,
  ) {
    return this.swaps.counter(clerkId, id, dto);
  }

  // Proposer accepts the owner's counter.
  @Post(':id/accept-counter')
  acceptCounter(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.acceptCounter(clerkId, id);
  }

  // Proposer rejects the owner's counter.
  @Post(':id/reject-counter')
  rejectCounter(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.rejectCounter(clerkId, id);
  }

  // Proposer withdraws while still pending.
  @Post(':id/withdraw')
  withdraw(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.swaps.withdraw(clerkId, id);
  }
}
