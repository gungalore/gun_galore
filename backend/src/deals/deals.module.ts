import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DealsService } from './deals.service';
import { DealsAdminController } from './deals-admin.controller';
import { DealsPublicController } from './deals-public.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminAuditService } from '../admin/admin-audit.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

// Daily Deals (DD-1). Self-contained module (Pattern B, mirrors
// FeaturedModule): JwtModule for the AdminJwtGuard on the admin
// controller; AdminAuditService provided locally (it only needs the
// global PrismaService). PrismaService, CloudinaryService, SettingsService
// and ReferenceNumberService all come from their @Global() modules.
//
// DD-F JIT supplier fulfilment adds three imports:
//   • SuppliersModule — DealsService validates the supplier link on create/update.
//   • ShippingModule — markStockReadyAndBook() calls ShippingService.bookForTransaction.
//   • ZohoBooksModule (NOT @Global) — the PO triggers call ZohoBooksService.
// None of these import DealsModule, so there is no cycle (no forwardRef needed).
// PaymentsModule imports DealsModule (spine agent) for the syncDealSoldOut PO
// trigger; that edge is one-way (Payments → Deals), so it stays acyclic too.
@Module({
  imports: [
    JwtModule.register({}),
    SuppliersModule,
    ShippingModule,
    ZohoBooksModule,
  ],
  // DealsPublicController is unguarded (public storefront reads); its methods
  // gate internally on FLAGS.dealsEnabled so the surface ships inert (DD-3).
  controllers: [DealsAdminController, DealsPublicController],
  providers: [DealsService, AdminJwtGuard, AdminAuditService],
  exports: [DealsService],
})
export class DealsModule {}
