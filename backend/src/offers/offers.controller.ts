import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OffersService } from './offers.service';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';

@Controller('offers')
@UseGuards(ClerkGuard)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // Buyer: submit a new offer.
  // Tighter limit (5/min/user) to discourage low-ball spam — every
  // offer triggers a seller notification (email + SMS) which is real
  // money. Backend also enforces one active offer per buyer per
  // listing so this is double-defence.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  submit(@CurrentUser() clerkId: string, @Body() dto: CreateOfferDto) {
    return this.offersService.submit(clerkId, dto);
  }

  // Buyer: view own offers
  @Get('mine')
  getMyOffers(@CurrentUser() clerkId: string) {
    return this.offersService.getMyOffers(clerkId);
  }

  // Seller: view offers received on their listings
  @Get('received')
  getReceived(@CurrentUser() clerkId: string) {
    return this.offersService.getReceivedOffers(clerkId);
  }

  // Either party: get single offer
  @Get(':id')
  getOne(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.offersService.getById(clerkId, id);
  }

  // Seller: accept original offer
  @Post(':id/accept')
  accept(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.offersService.accept(clerkId, id);
  }

  // Seller: reject offer — structured reason required (ticklist); note
  // required when reason=OTHER. Reason drives the seller-standing policy.
  @Post(':id/reject')
  reject(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string; note?: string },
  ) {
    return this.offersService.reject(clerkId, id, body?.reason, body?.note);
  }

  // Seller: counter the offer
  @Post(':id/counter')
  counter(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: CounterOfferDto,
  ) {
    return this.offersService.counter(clerkId, id, dto);
  }

  // Buyer: accept seller's counter
  @Post(':id/accept-counter')
  acceptCounter(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.offersService.acceptCounter(clerkId, id);
  }

  // Buyer: reject seller's counter
  @Post(':id/reject-counter')
  rejectCounter(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.offersService.rejectCounter(clerkId, id);
  }

  // Buyer: withdraw offer
  @Post(':id/withdraw')
  withdraw(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.offersService.withdraw(clerkId, id);
  }
}
