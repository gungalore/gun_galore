import { Module, Global, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersPublicController } from './users-public.controller';
import { WebhooksController } from './webhooks.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { PaymentsModule } from '../payments/payments.module';

// Global because the ClerkGuard depends on UsersService — and the guard is
// instantiated per-controller-module by Nest. Making this global means any
// module that applies @UseGuards(ClerkGuard) can resolve the guard's deps.
//
// PaymentsModule is imported via forwardRef because PaymentsModule already
// indirectly pulls in things that touch UsersModule's global guard at
// boot time. Profile-complete needs PeachService.verifyBankAccount() for
// the AVS check before we save bank details.
@Global()
@Module({
  imports: [CloudinaryModule, forwardRef(() => PaymentsModule)],
  // Public controller listed BEFORE the auth-guarded one so its routes
  // are matched first (Nest resolves by registration order).
  controllers: [WebhooksController, UsersPublicController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
