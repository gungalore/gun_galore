import { Module, Global } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersPublicController } from './users-public.controller';
import { SellersPublicController } from './sellers-public.controller';
import { SellerToolsController } from './seller-tools.controller';
import { SellerToolsService } from './seller-tools.service';
import { WebhooksController } from './webhooks.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MotivationsModule } from '../motivations/motivations.module';
import { LicenceCentreModule } from '../licence-centre/licence-centre.module';

// Global because the ClerkGuard depends on UsersService — and the guard is
// instantiated per-controller-module by Nest. Making this global means any
// module that applies @UseGuards(ClerkGuard) can resolve the guard's deps.
//
// (Previously imported PaymentsModule for PeachService.verifyBankAccount()
// — that automated AVS check was removed with Peach, so the dependency is
// gone too.)
@Global()
@Module({
  // MotivationsModule for MotivationRetentionService: the Clerk
  // user.deleted handler has to remove a member's encrypted licence
  // documents itself, because the cascade that removes their rows cannot
  // reach the filesystem. No cycle — nothing in motivations/ imports users.
  imports: [CloudinaryModule, MotivationsModule, LicenceCentreModule],
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
