import { Module } from '@nestjs/common';
import { PudoService } from './pudo.service';
import { TcgService } from './tcg.service';
import { DealersService } from './dealers.service';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';

@Module({
  providers: [PudoService, TcgService, DealersService, ShippingService],
  controllers: [ShippingController],
  exports: [ShippingService, PudoService, TcgService, DealersService],
})
export class ShippingModule {}
