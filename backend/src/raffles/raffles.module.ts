import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RafflesService } from './raffles.service';
import {
  RafflesPublicController,
  RafflesBuyerController,
  RafflesAdminController,
} from './raffles.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PaymentsModule } from '../payments/payments.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';

@Module({
  // JwtModule needed because AdminJwtGuard depends on JwtService.
  // CloudinaryModule + PaymentsModule are pulled in so RafflesService
  // can do image uploads and Peach refunds (admin "Refund all buyers").
  // ZohoBooksModule explicit import — even though it's @Global, the
  // load-order resolution doesn't always work, so we import it
  // directly to guarantee ZohoBooksService is resolvable here.
  imports: [
    JwtModule.register({}),
    CloudinaryModule,
    PaymentsModule,
    ZohoBooksModule,
  ],
  controllers: [
    RafflesPublicController,
    RafflesBuyerController,
    RafflesAdminController,
  ],
  providers: [RafflesService, AdminJwtGuard],
  exports: [RafflesService],
})
export class RafflesModule {}
