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
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';

@Controller('offers')
@UseGuards(AuthGuard)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // Buyer: submit a new offer.
  // Tighter limit (5/min/user) to discourage low-ball spam — every
  // offer triggers a seller notification (email + SMS) which is real
  // money. Backend also enforces one active offer per buyer per
  // listing so this is double-defence.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  submit(@CurrentUser() userId: string, @Body() dto: CreateOfferDto) {
    return this.offersService.submit(userId, dto);
  }

  // Buyer: view own offers
  @Get('mine')
  getMyOffers(@CurrentUser() userId: string) {
    return this.offersService.getMyOffers(userId);
  }

  // Seller: view offers received on their listings
  @Get('received')
  getReceived(@CurrentUser() userId: string) {
    return this.offersService.getReceivedOffers(userId);
  }

  // Either party: get single offer
  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.offersService.getById(userId, id);
  }

  // Seller: accept original offer
  @Post(':id/accept')
  accept(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.offersService.accept(userId, id);
  }

  // Seller: reject offer — structured reason required (ticklist); note
  // required when reason=OTHER. Reason drives the seller-standing policy.
  @Post(':id/reject')
  reject(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string; note?: string },
  ) {
    return this.offersService.reject(userId, id, body?.reason, body?.note);
  }

  // Seller: counter the offer
  @Post(':id/counter')
  counter(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CounterOfferDto,
  ) {
    return this.offersService.counter(userId, id, dto);
  }

  // Buyer: accept seller's counter
  @Post(':id/accept-counter')
  acceptCounter(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.offersService.acceptCounter(userId, id);
  }

  // Buyer: reject seller's counter
  @Post(':id/reject-counter')
  rejectCounter(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.offersService.rejectCounter(userId, id);
  }

  // Buyer: withdraw offer
  @Post(':id/withdraw')
  withdraw(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.offersService.withdraw(userId, id);
  }
}
