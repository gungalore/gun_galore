import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FeaturedService } from './featured.service';
import {
  FeaturedAdminController,
  FeaturedPublicController,
  FeaturedSellerController,
} from './featured.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // JwtModule for AdminJwtGuard. PaymentsModule for Peach refunds on
  // admin force-evict.
  imports: [JwtModule.register({}), PaymentsModule],
  controllers: [
    FeaturedPublicController,
    FeaturedSellerController,
    FeaturedAdminController,
  ],
  providers: [FeaturedService, AdminJwtGuard],
  exports: [FeaturedService],
})
export class FeaturedModule {}
