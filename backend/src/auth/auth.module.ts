import { Module, Global, forwardRef } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import { ClerkOrTokenGuard } from './clerk-or-token.guard';
import { KycOrTokenGuard } from './kyc-or-token.guard';
import { UsersModule } from '../users/users.module';
import { ActionTokensModule } from '../actions/action-tokens.module';

// Global so any controller can `@UseGuards(ClerkGuard)` (or
// `ClerkOrTokenGuard` for endpoints reachable from SMS-link
// checkout, or `KycOrTokenGuard` for the SMS-link KYC flow) without
// importing this module.
//
// forwardRef on ActionTokensModule: ActionTokensModule transitively
// touches AuthModule via UsersModule, which would create a cycle.
@Global()
@Module({
  imports: [UsersModule, forwardRef(() => ActionTokensModule)],
  providers: [ClerkGuard, ClerkOrTokenGuard, KycOrTokenGuard],
  exports: [ClerkGuard, ClerkOrTokenGuard, KycOrTokenGuard],
})
export class AuthModule {}
