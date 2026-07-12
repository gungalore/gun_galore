import { Module, Global } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersPublicController } from './users-public.controller';
import { SellersPublicController } from './sellers-public.controller';
import { SellerToolsController } from './seller-tools.controller';
import { SellerToolsService } from './seller-tools.service';
import { WebhooksController } from './webhooks.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

// Global because the ClerkGuard depends on UsersService — and the guard is
// instantiated per-controller-module by Nest. Making this global means any
// module that applies @UseGuards(ClerkGuard) can resolve the guard's deps.
//
// (Previously imported PaymentsModule for PeachService.verifyBankAccount()
// — that automated AVS check was removed with Peach, so the dependency is
// gone too.)
@Global()
@Module({
  imports: [CloudinaryModule],
  // Public controller listed BEFORE the auth-guarded one so its routes
  // are matched first (Nest resolves by registration order).
  controllers: [
    WebhooksController,
    UsersPublicController,
    SellersPublicController,
    SellerToolsController,
    UsersController,
  ],
  providers: [UsersService, SellerToolsService],
  // SellerToolsService exported for the Ask GG account tools (W5) —
  // UsersModule is @Global, so both are injectable app-wide.
  exports: [UsersService, SellerToolsService],
})
export class UsersModule {}
