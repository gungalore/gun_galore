import { Module } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { AuctionsController } from './auctions.controller';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService, OptionalAuthGuard, ContentAccessGuard],
  exports: [AuctionsService],
})
export class AuctionsModule {}
