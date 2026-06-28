import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

// Phase 8b — single-seller multi-item cart. Imports PaymentsModule purely for
// the exported TransactionsService (which owns the hardened reserve/fan-out
// money path); PrismaModule + AuthModule are @Global so no other imports are
// needed. No admin guard here → no JwtModule (the AdminJwtGuard crash-loop
// rule does not apply).
@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
