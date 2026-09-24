import { Module } from '@nestjs/common';
import { BobGoService } from './bobgo.service';
import { BobGoWebhookService } from './bobgo-webhook.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
import { TrackingService } from './tracking.service';
import { ShippingController } from './shipping.controller';

@Module({
  providers: [
    BobGoService,
    BobGoWebhookService,
    DealersService,
    ShippingService,
    TrackingService,
  ],
  controllers: [ShippingController],
  exports: [
    ShippingService,
    BobGoService,
    BobGoWebhookService,
    DealersService,
    TrackingService,
  ],
})
export class ShippingModule {}
