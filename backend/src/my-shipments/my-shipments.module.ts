import { Module } from '@nestjs/common';
import { MyShipmentsController } from './my-shipments.controller';
import { MyShipmentsService } from './my-shipments.service';

// Read-only aggregation for the account Shipping module. PrismaService +
// ClerkGuard are both @Global (PrismaModule / AuthModule) — no imports.
@Module({
  controllers: [MyShipmentsController],
  providers: [MyShipmentsService],
})
export class MyShipmentsModule {}
