import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FeaturedService } from './featured.service';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import {
  FeaturedAdminController,
  FeaturedPublicController,
  FeaturedSellerController,
} from './featured.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PaymentsModule } from '../payments/payments.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

@Module({
  // JwtModule for AdminJwtGuard. PaymentsModule for Peach refunds on
  // admin force-evict. ZohoBooksModule for the featured-slot fee
  // Sales Receipt posted from bindListingToSlot().
  imports: [JwtModule.register({}), PaymentsModule, ZohoBooksModule],
  controllers: [
    FeaturedPublicController,
    FeaturedSellerController,
    FeaturedAdminController,
  ],
  // OptionalClerkGuard must be PROVIDED, not just referenced by the
  // controller — otherwise Nest crash-loops at boot while tsc stays green.
  providers: [FeaturedService, AdminJwtGuard, OptionalClerkGuard],
  exports: [FeaturedService],
})
export class FeaturedModule {}
