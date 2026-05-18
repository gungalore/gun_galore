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
  ForbiddenException,
} from '@nestjs/common';
import { PudoService } from './pudo.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
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
  // Pudo locker search — public, no auth required
  // ---------------------------------------------------------------
  @Get('pudo/lockers')
  findLockers(@Query() q: LockerSearchDto) {
    return this.pudo.getNearbyLockers(q.lat, q.lng, q.radiusKm, q.limit);
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
    if (expected && secret !== expected) {
      this.logger.warn('TCG webhook rejected — invalid secret');
      throw new ForbiddenException('Invalid webhook secret');
    }

    const event = (body.event ?? body.eventType ?? 'unknown') as string;
    await this.shipping.processTcgEvent(event, body);
    return { received: true };
  }

  // ---------------------------------------------------------------
  // Pudo webhook — public route, no JWT, no auth key (CLAUDE.md).
  // Always returns 200 regardless of content.
  // ---------------------------------------------------------------
  @Post('webhook/pudo')
  @HttpCode(200)
  async pudoWebhook(@Body() body: Record<string, unknown>) {
    await this.shipping.processPudoEvent(body);
    return { received: true };
  }
}
