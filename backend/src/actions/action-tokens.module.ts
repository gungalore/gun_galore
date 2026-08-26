import { Module, Global, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActionTokensService } from './action-tokens.service';
import { ActionTokensController } from './action-tokens.controller';
import { ScanHandoffController } from './scan-handoff.controller';
import { OffersModule } from '../offers/offers.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { ListingsModule } from '../listings/listings.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * ActionTokensModule — public, token-gated single-action endpoints.
 *
 * Exposes /actions/:token routes that map token-bearing requests to
 * the same underlying services the authenticated /offers, /auctions
 * etc. endpoints use.
 *
 * @Global so that ClerkOrTokenGuard (lives in AuthModule, which is
 * itself @Global) can inject ActionTokensService from anywhere
 * without each consumer module having to re-import this one.
 *
 * forwardRef on OffersModule + AuctionsModule breaks the cycle that
 * forms when those modules want to mint tokens at creation time
 * (e.g. OffersService minting an OFFER_DECISION token when an
 * offer is submitted).
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OffersModule),
    forwardRef(() => AuctionsModule),
    ListingsModule,
    // PaymentsModule exports TransactionsService — needed for the
    // /actions/:token/accept-transaction + /dispatch endpoints to
    // call the existing acceptTransaction / confirmDispatch methods.
    forwardRef(() => PaymentsModule),
  ],
  providers: [ActionTokensService],
  controllers: [ActionTokensController, ScanHandoffController],
  exports: [ActionTokensService],
})
export class ActionTokensModule {}
