import { Module } from '@nestjs/common';
import { WishlistAlertsService } from './wishlist-alerts.service';
import { PushModule } from '../push/push.module';

// NotificationsModule is @Global (exports NotificationsService), so it needn't
// be imported here. PushModule provides PushService for the explicit push.
// Exported so ListingsModule (price drop) and PaymentsModule (item sold) can
// inject the shared fan-out.
@Module({
  imports: [PushModule],
  providers: [WishlistAlertsService],
  exports: [WishlistAlertsService],
})
export class WishlistAlertsModule {}
