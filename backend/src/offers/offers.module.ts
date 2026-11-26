import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { AuctionsModule } from '../auctions/auctions.module';

@Module({
  // AuctionsService so an accepted offer on a live auction can close the
  // auction off the bid path properly (loser notices + settlement stamp).
  // One-way: AuctionsModule does not import this module.
  imports: [AuctionsModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
