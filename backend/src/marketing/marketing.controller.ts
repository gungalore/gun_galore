import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MarketingService } from './marketing.service';

/**
 * Public campaign resolution — anonymous by design (the visitor arriving
 * from an SMS link is not signed in). Counts the hit. Unknown/inactive keys
 * return { campaign: null } so stale SMSes simply show nothing.
 */
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('campaign/:key')
  resolve(@Param('key') key: string) {
    return this.marketing.resolve(key);
  }
}
