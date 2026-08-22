import { Module, Global } from '@nestjs/common';
import { UsersService } from './users.service';
import { VaultConsentService } from './vault-consent.service';
import { UsersController } from './users.controller';
import { UsersPublicController } from './users-public.controller';
import { SellersPublicController } from './sellers-public.controller';
import { SellerToolsController } from './seller-tools.controller';
import { SellerToolsService } from './seller-tools.service';
import { WebhooksController } from './webhooks.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MotivationsModule } from '../motivations/motivations.module';
import { LicenceCentreModule } from '../licence-centre/licence-centre.module';
import { KycModule } from '../kyc/kyc.module';

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
  // KycModule for purgeKycFiles: the identity document and selfie are
  // encrypted files on our own disk, and a Prisma cascade cannot reach the
  // filesystem. No cycle — nothing in kyc/ imports users.
  imports: [
    CloudinaryModule,
    MotivationsModule,
    LicenceCentreModule,
    KycModule,
  ],
  // Public controller listed BEFORE the auth-guarded one so its routes
  // are matched first (Nest resolves by registration order).
  controllers: [
    WebhooksController,
    UsersPublicController,
    SellersPublicController,
    SellerToolsController,
    UsersController,
  ],
  // ⚠️ VaultConsentService IS HERE FOR THE MODULE GRAPH, not because it is
  // about users. Both the Document Centre and the motivations module need it,
  // and LicenceCentreModule already imports MotivationsModule — so the Centre
  // cannot own it without a cycle. This module is @Global and the columns it
  // reads are on User, so from here it reaches both with no new edge.
  providers: [UsersService, SellerToolsService, VaultConsentService],
  // SellerToolsService exported for the Ask GG account tools (W5) —
  // UsersModule is @Global, so both are injectable app-wide.
  exports: [UsersService, SellerToolsService, VaultConsentService],
})
export class UsersModule {}
