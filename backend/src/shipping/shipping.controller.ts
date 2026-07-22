import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  Headers,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { PudoService } from './pudo.service';
import { DealersService } from './dealers.service';
import {
  ShippingService,
  type QuoteRequestBody,
} from './shipping.service';
import { LockerSearchDto } from './dto/locker-search.dto';
import { DealerQueryDto } from './dto/dealer-query.dto';

@Controller('shipping')
export class ShippingController {
  private readonly logger = new Logger(ShippingController.name);

  constructor(
    private readonly pudo: PudoService,
    private readonly dealers: DealersService,
    private readonly shipping: ShippingService,
  ) {}

  // ---------------------------------------------------------------
  // Pudo locker lookups — public, no auth required.
  //   GET /shipping/pudo/lockers              → nearest-to-lat-lng list
  //   GET /shipping/pudo/lockers/search?q=    → Meilisearch-backed search
  // ---------------------------------------------------------------
  @Get('pudo/lockers')
  findLockers(@Query() q: LockerSearchDto) {
    return this.pudo.getNearbyLockers({
      lat: q.lat,
      lng: q.lng,
      postalCode: q.postalCode,
      radiusKm: q.radiusKm,
      limit: q.limit,
    });
  }

  @Get('pudo/lockers/search')
  searchLockers(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    const cap = limit ? Math.min(parseInt(limit, 10) || 10, 50) : 10;
    return this.pudo.searchLockers(q ?? '', cap);
  }

  // ---------------------------------------------------------------
  // Dealer list — public, no auth required
  // ---------------------------------------------------------------
  @Get('dealers')
  findDealers(@Query() q: DealerQueryDto) {
    return this.dealers.findAll(q.province);
  }

  @Get('dealers/:id')
  findDealer(@Param('id') id: string) {
    return this.dealers.findById(id);
  }

  // ---------------------------------------------------------------
  // Delivery options for a given isFirearm flag
  // ---------------------------------------------------------------
  @Get('options')
  getOptions(@Query('isFirearm') isFirearm: string) {
    return {
      methods: this.shipping.getDeliveryOptions(isFirearm === 'true'),
    };
  }

  // ---------------------------------------------------------------
  // Live shipping rate for a listing. Called from the checkout form
  // after the buyer selects a method + locker/address. The returned
  // priceCents is what the checkout breakdown shows AND what we
  // re-quote at transaction-create time so the buyer's card lands on
  // the exact amount they saw. Public — listings are public anyway.
  // ---------------------------------------------------------------
  @Post('quote')
  @HttpCode(200)
  async quote(@Body() body: QuoteRequestBody) {
    return this.shipping.quoteForListing(body);
  }

  // ---------------------------------------------------------------
  // TCG webhook — public route, no JWT.
  // Auth: TCG_WEBHOOK_SECRET in x-tcg-webhook-secret header.
  // Always returns 200 to acknowledge receipt (CLAUDE.md rule).
  // ---------------------------------------------------------------
  @Post('webhook/tcg')
  @HttpCode(200)
  async tcgWebhook(
    @Headers('x-tcg-webhook-secret') secret: string,
    @Body() body: Record<string, unknown>,
  ) {
    const expected = process.env.TCG_WEBHOOK_SECRET;
    // Fail CLOSED: if the secret isn't configured, reject in production
    // (a missing secret previously short-circuited the check entirely,
    // letting anyone POST shipping events). Dev is allowed through so
    // local testing works without the secret wired.
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'TCG webhook rejected — TCG_WEBHOOK_SECRET not configured in production',
        );
        return { received: true };
      }
    } else if (secret !== expected) {
      this.logger.warn('TCG webhook rejected — invalid secret');
      return { received: true };
    }

    try {
      await this.shipping.processTcgEvent(body);
    } catch (err) {
      this.logger.error(
        `TCG webhook handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    return { received: true };
  }

  // ---------------------------------------------------------------
  // Pudo webhook — public route, no JWT, no auth key (CLAUDE.md).
  // Always returns 200 regardless of content.
  // ---------------------------------------------------------------
  @Post('webhook/pudo')
  @HttpCode(200)
  async pudoWebhook(@Body() body: Record<string, unknown>) {
    try {
      await this.shipping.processPudoEvent(body);
    } catch (err) {
      this.logger.error(
        `Pudo webhook handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    return { received: true };
  }
}
