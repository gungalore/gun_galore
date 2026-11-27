import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersService } from './orders.service';
import {
  OrdersController,
  OrdersPublicController,
} from './orders.controller';

// Phase 8b — multi-item cart. Imports PaymentsModule purely for the exported
// TransactionsService (which owns the hardened reserve/fan-out money path);
// PrismaModule + AuthModule are @Global so no other imports are needed. No
// admin guard here → no JwtModule (the AdminJwtGuard crash-loop rule does not
// apply). OrdersPublicController is the unauthenticated gateway-return route;
// it lives outside the AuthGuard controller for the same reason the ratings
// public controller does.
@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController, OrdersPublicController],
  providers: [OrdersService],
})
export class OrdersModule {}
