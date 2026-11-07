import { Module } from '@nestjs/common';
import { BobGoService } from './bobgo.service';
import { BobGoWebhookService } from './bobgo-webhook.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
import { TrackingService } from './tracking.service';
import { ShippingController } from './shipping.controller';
// The courier's re-weigh charge is the SELLER's, and BobGoWebhookService both
// raises the ledger row and asks Books for the invoice that explains it.
import { ZohoBooksModule } from '../zoho/zoho-books.module';

@Module({
  imports: [ZohoBooksModule],
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
