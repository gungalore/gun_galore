import { Module } from '@nestjs/common';
import { PudoService } from './pudo.service';
import { TcgService } from './tcg.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
import { TrackingService } from './tracking.service';
import { PostalCodesService } from './postal-codes.service';
import { ShippingController } from './shipping.controller';

@Module({
  providers: [
    PudoService,
    TcgService,
    DealersService,
    ShippingService,
    TrackingService,
    PostalCodesService,
  ],
  controllers: [ShippingController],
  exports: [
    ShippingService,
    PudoService,
    TcgService,
    DealersService,
    TrackingService,
    PostalCodesService,
  ],
})
export class ShippingModule {}
