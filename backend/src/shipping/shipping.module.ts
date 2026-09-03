import { Module } from '@nestjs/common';
import { BobGoService } from './bobgo.service';
import { BobGoWebhookService } from './bobgo-webhook.service';
import { PudoService } from './pudo.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
import { TrackingService } from './tracking.service';
import { PostalCodesService } from './postal-codes.service';
import { ShippingController } from './shipping.controller';

@Module({
  providers: [
    BobGoService,
    BobGoWebhookService,
    PudoService,
    DealersService,
    ShippingService,
    TrackingService,
    PostalCodesService,
  ],
  controllers: [ShippingController],
  exports: [
    ShippingService,
    BobGoService,
    BobGoWebhookService,
    PudoService,
    DealersService,
    TrackingService,
    PostalCodesService,
  ],
})
export class ShippingModule {}
