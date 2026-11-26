import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Inject,
  forwardRef,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActionTokensService,
  ResolvedToken,
} from './action-tokens.service';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
import { TransactionsService } from '../payments/transactions.service';
import { ListingsService } from '../listings/listings.service';
import { sellerBreakdown } from '../payments/fee-presentation';
import {
  nextPickupDay,
  parseAcceptSchedule,
  soonestPickupDate,
} from '../shipping/pickup-dates';
import { cutoffHour, resolveServiceLevel } from '../shipping/service-levels';

/** Public listing snapshot a token checkout page can render without a session. */
interface CheckoutListingSnapshot {
  id: string;
  title: string;
  listPrice: number | null;
  reference: string | null;
  primaryImageUrl: string | null;
  status: string;
}

/**
 * Payload returned by GET /actions/:token for a CHECKOUT token.
 *
 * Two shapes, switched on the token's targetType:
 *  - listing → auction-winner / Buy-Now checkout (`/checkout/<id>?t=`);
 *  - offer   → accepted-offer pay window (`/checkout/offer/<id>?t=`), with the
 *              offer snapshot the token page needs to explain the deal.
 */
type CheckoutResolvePayload =
  | {
      kind: 'CHECKOUT';
      expiresAt: string;
      greeting: string;
      listing: CheckoutListingSnapshot;
      redirectTo: string;
    }
  | {
      kind: 'CHECKOUT';
      expiresAt: string;
      greeting: string;
      listing: CheckoutListingSnapshot;
      offer: {
        id: string;
        amount: number;
        counterAmount: number | null;
        expiresAt: string;
        status: string;
      };
      redirectTo: string;
    };

/**
 * Public, token-gated endpoints powering the /a/<token> SMS-link
 * action pages. Every route here is unauthenticated — the token
 * itself is the auth credential.
 *
 * Pattern:
 *   GET  /actions/:token                  → resolve, return scoped payload for UI render
 *   POST /actions/:token/accept-offer     → call OffersService.accept on behalf of token's user
 *   POST /actions/:token/reject-offer
 *   POST /actions/:token/counter-offer    body: { amount, note? }
 *   POST /actions/:token/accept-counter
 *   POST /actions/:token/reject-counter
 *   POST /actions/:token/counter-back     body: { amount, note? }
 *   POST /actions/:token/place-bid        body: { maxAmount, isOneShot }
 *
 * Each POST handler:
 *   1. Resolves token + validates purpose/targetType (via ActionTokensService.runAction)
 *   2. Looks up the authorisedUserId → userId (so we can call the
 *      existing AuthGuard-style services without modifying them)
 *   3. Calls the underlying service method
 *   4. Marks the token consumed
 *
 * Rate-limited per-IP at the throttler (default 60/min/IP) — that
 * stops fire-hose token guessing. Per-token brute-force lock at 5
 * invalid attempts is in ActionTokensService.
 */
@Controller('actions')
export class ActionTokensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ActionTokensService,
    @Inject(forwardRef(() => OffersService))
    private readonly offers: OffersService,
    @Inject(forwardRef(() => AuctionsService))
    private readonly auctions: AuctionsService,
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactions: TransactionsService,
    // Needed by GET :token/checkout-listing — a CHECKOUT link is the only
    // credential a signed-out auction winner has, so the checkout page must be
    // able to read its one listing without a session or the ao_cat gate cookie.
    private readonly listings: ListingsService,
  ) {}

  // ─── Resolve: render data for the /a/:token page ─────────────────

  /**
   * Returns the data the frontend needs to render the right UI:
   * which purpose, which target, the listing/offer/auction snapshot,
   * the user's display name (so the page can greet them by username).
   *
   * Does NOT consume the token — the page can re-load this freely.
   */
  @Get(':token')
  @SkipThrottle()
  async resolve(@Param('token') token: string) {
    const resolved = await this.tokens.resolve(token);

    // Fetch the user (need username for greeting + userId for downstream)
    const user = await this.prisma.user.findUnique({
      where: { id: resolved.authorisedUserId },
      select: {
        id: true,
        username: true,
        firstName: true,
      },
    });
    if (!user) throw new NotFoundException('User no longer exists');

    // Per-purpose payload assembly — fetch the relevant entity and
    // shape the response the frontend will switch on.
    switch (resolved.purpose) {
      case 'OFFER_DECISION':
      case 'COUNTER_DECISION':
        return this.buildOfferPayload(resolved, user);
      case 'AUCTION_BID':
        return this.buildAuctionPayload(resolved, user);
      case 'AUCTION_RUNNER_UP':
        return this.buildRunnerUpPayload(resolved, user);
      case 'CHECKOUT':
        return this.buildCheckoutPayload(resolved, user);
      case 'KYC_VERIFY':
        return this.buildKycVerifyPayload(resolved, user);
      case 'SCAN_HANDOFF':
        return this.buildScanHandoffPayload(resolved);
      case 'DISPATCH':
        return this.buildDispatchPayload(resolved, user);
      case 'TRANSACTION_ACCEPT':
        return this.buildTransactionAcceptPayload(resolved, user);
      case 'PRIVATE_ARRANGE_ACTION':
        return this.buildPrivateArrangeActionPayload(resolved, user);
      case 'SWAP_PROPOSAL_DECISION':
      case 'SWAP_COUNTER_DECISION':
      default:
        throw new BadRequestException(`Unknown token purpose: ${resolved.purpose}`);
    }
  }

  // ─── CHECKOUT token: read the one listing it authorises ──────────
  //
  // The winner's "pay within 24h" SMS/email lands on /a/<token>, which
  // redirects to /checkout/<listingId>?t=<token>. That page is exempt from
  // the 18+ gate because the token is the credential — but its SERVER-side
  // listing fetch carries no cookies, so GET /listings/:id (which sits behind
  // ContentAccessGuard) 404s and the winner sees the not-found page. This
  // endpoint is the token-scoped replacement: it validates the token, then
  // serves the same public listing projection for that ONE target.
  //
  // Deliberately narrow:
  //  - CHECKOUT tokens only (the only kind that can pay a listing);
  //  - the listing must be the token's own target and an AUCTION (the only
  //    thing CHECKOUT tokens are ever minted for today);
  //  - no userId is passed to findById, so the public projection is returned
  //    (no owner extras such as reservePrice);
  //  - the token is NOT consumed by a read (the page can be reloaded).
  @Get(':token/checkout-listing')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async checkoutListing(@Param('token') token: string) {
    const resolved = await this.tokens.resolve(token);
    if (resolved.purpose !== 'CHECKOUT' || resolved.targetType !== 'listing') {
      await this.tokens.markInvalid(token);
      throw new ForbiddenException('This link cannot perform that action.');
    }
    const listing = await this.listings
      .findById(resolved.targetId)
      .catch(() => null);
    if (!listing || listing.listingType !== 'AUCTION') {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  // ─── CHECKOUT token on an ACCEPTED OFFER ────────────────────────
  //
  // The accepted-offer pay-now SMS/email lands on /a/<token>, which redirects
  // to /checkout/offer/<offerId>?t=<token>. That page is exempt from the 18+
  // gate and needs no session (the token is the credential), but its
  // SERVER-side offer fetch cannot use the authenticated GET /offers/:id — so
  // this endpoint is the token-scoped replacement. It returns exactly what the
  // offer checkout form needs, and nothing more:
  //  - CHECKOUT tokens only, and only on the token's OWN target offer;
  //  - the token's buyer must still be the offer's buyer (a re-issued token
  //    for a different account must not read somebody else's negotiation);
  //  - the listing is the PUBLIC projection (ListingsService.findById with no
  //    userId), so no owner extras such as reserve price/auto-accept;
  //  - the token is NOT consumed by a read (the page can be reloaded, and a
  //    failed Pay must not burn the only link the buyer has).
  @Get(':token/offer-checkout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async offerCheckout(@Param('token') token: string) {
    const resolved = await this.tokens.resolve(token);
    if (resolved.purpose !== 'CHECKOUT' || resolved.targetType !== 'offer') {
      await this.tokens.markInvalid(token);
      throw new ForbiddenException('This link cannot perform that action.');
    }
    const offer = await this.prisma.offer.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        status: true,
        offerAmount: true,
        counterAmount: true,
        expiresAt: true,
        buyerId: true,
        listingId: true,
      },
    });
    // Same 404 for "gone" and "not yours": the token is the auth credential,
    // so a mismatch must not confirm that another buyer's offer exists.
    if (!offer || offer.buyerId !== resolved.authorisedUserId) {
      throw new NotFoundException('Offer not found');
    }
    const listing = await this.listings
      .findById(offer.listingId)
      .catch(() => null);
    if (!listing) throw new NotFoundException('Listing not found');
    return { offer, listing };
  }

  // ─── Transaction accept (TOK-7 Phase 1) ─────────────────────────
  // Seller's one-tap "I will handle this sale" from the post-payment
  // SMS. Token authorisedUserId is the seller. 48h TTL.

  @Post(':token/accept-transaction')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptTransaction(
    @Param('token') token: string,
    @Body() body: { collectionNotBefore?: string; collectionWindow?: string },
    @Req() req: Request,
  ) {
    return this.tokens.runAction(
      token,
      'TRANSACTION_ACCEPT',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.acceptTransaction(
          targetId,
          userId,
          parseAcceptSchedule(body ?? {}),
        );
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Auction runner-up (BIG-2) ──────────────────────────────────
  // Seller's one-tap "yes, offer it to the next bidder" after a winner blew
  // the pay window. The runner-up id + amount come from the TOKEN's metadata,
  // never from the request body — otherwise anyone holding the link could
  // nominate an arbitrary buyer at an arbitrary price. Both are re-validated
  // against live state inside offerToRunnerUp.
  @Post(':token/offer-runner-up')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  offerRunnerUp(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'AUCTION_RUNNER_UP',
      'listing',
      async ({ targetId, authorisedUserId, metadata }) => {
        const bidderId = metadata?.runnerUpBidderId;
        const amount = metadata?.runnerUpAmount;
        if (typeof bidderId !== 'string' || typeof amount !== 'number') {
          throw new BadRequestException('This offer link is incomplete');
        }
        const result = await this.auctions.offerToRunnerUp(
          targetId,
          authorisedUserId,
          bidderId,
          amount,
        );
        // A refusal (already relisted, bidder now banned) must NOT burn the
        // token silently as if it worked — surface it so the page can explain.
        if (!result.offered) {
          throw new BadRequestException(result.reason ?? 'Could not offer it');
        }
        return result;
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // Reject reuses the SAME TRANSACTION_ACCEPT token (the token gives the
  // seller the authority to make EITHER decision). Reason is required.
  @Post(':token/reject-transaction')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectTransaction(
    @Param('token') token: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    const reason = (body?.reason ?? '').toString();
    if (reason.trim().length < 3) {
      throw new BadRequestException('Reason is required.');
    }
    return this.tokens.runAction(
      token,
      'TRANSACTION_ACCEPT',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.rejectTransaction(targetId, userId, reason);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Private Arrangement handover ────────────────────────────────
  // The seller ("Item delivered"), buyer ("Item received") and either party
  // ("Dispute") actions from the PA email/SMS link. The token is minted
  // per party and records the role in metadata.

  @Post(':token/private-arrange-delivered')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  privateArrangeDelivered(
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    return this.tokens.runAction(
      token,
      'PRIVATE_ARRANGE_ACTION',
      'transaction',
      async ({ targetId, authorisedUserId, metadata }) => {
        if (metadata?.role !== 'seller') {
          throw new BadRequestException('Only the seller can mark this delivered.');
        }
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.markPrivateArrangeDelivered(targetId, userId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/private-arrange-received')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  privateArrangeReceived(
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    return this.tokens.runAction(
      token,
      'PRIVATE_ARRANGE_ACTION',
      'transaction',
      async ({ targetId, authorisedUserId, metadata }) => {
        if (metadata?.role !== 'buyer') {
          throw new BadRequestException('Only the buyer can confirm receipt.');
        }
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.confirmPrivateArrangeReceived(targetId, userId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/private-arrange-dispute')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  privateArrangeDispute(
    @Param('token') token: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ) {
    const reason = (body?.reason ?? '').toString().trim();
    return this.tokens.runAction(
      token,
      'PRIVATE_ARRANGE_ACTION',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.disputePrivateArrange(
          targetId,
          userId,
          reason || 'Raised from the handover link',
        );
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Dispatch (TOK-7) ────────────────────────────────────────────
  // Seller's one-tap "mark dispatched" from the 48h nudge SMS. Token
  // authorisedUserId IS the seller. POST body provides the tracking ref.

  @Post(':token/dispatch')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  dispatch(
    @Param('token') token: string,
    @Body() body: { trackingReference?: string },
    @Req() req: Request,
  ) {
    const tracking = (body?.trackingReference ?? '').toString().trim();
    if (tracking.length === 0) {
      throw new BadRequestException('Tracking reference is required.');
    }
    if (tracking.length > 120) {
      throw new BadRequestException('Tracking reference too long (max 120).');
    }
    return this.tokens.runAction(
      token,
      'DISPATCH',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.transactions.confirmDispatch(targetId, userId, {
          trackingReference: tracking,
        });
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Offer actions ───────────────────────────────────────────────

  @Post(':token/accept-offer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptOffer(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'OFFER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.offers.accept(userId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/reject-offer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectOffer(
    @Param('token') token: string,
    @Body() body: { reason?: string; note?: string },
    @Req() req: Request,
  ) {
    return this.tokens.runAction(
      token,
      'OFFER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.offers.reject(userId, targetId, body?.reason, body?.note);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/counter-offer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  counterOffer(
    @Param('token') token: string,
    @Body() body: { amount?: number; note?: string },
    @Req() req: Request,
  ) {
    const counterAmount = Number(body?.amount);
    if (!Number.isFinite(counterAmount) || counterAmount <= 0) {
      throw new BadRequestException('Counter amount required (cents, positive integer)');
    }
    return this.tokens.runAction(
      token,
      'OFFER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.offers.counter(userId, targetId, {
          counterAmount: Math.round(counterAmount),
          sellerNote: body?.note?.toString().slice(0, 500),
        });
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/accept-counter')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptCounter(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'COUNTER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.offers.acceptCounter(userId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/reject-counter')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectCounter(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'COUNTER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.offers.rejectCounter(userId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Auction actions ─────────────────────────────────────────────

  @Post(':token/place-bid')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  placeBid(
    @Param('token') token: string,
    @Body() body: { maxAmount?: number; isOneShot?: boolean },
    @Req() req: Request,
  ) {
    const maxAmount = Number(body?.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      throw new BadRequestException('maxAmount required (cents, positive integer)');
    }
    const isOneShot = !!body?.isOneShot;
    return this.tokens.runAction(
      token,
      'AUCTION_BID',
      'listing',
      async ({ targetId, authorisedUserId }) => {
        const userId = await this.requireUser(authorisedUserId);
        return this.auctions.placeBid(userId, targetId, {
          maxAmount: Math.round(maxAmount),
          isOneShot,
        });
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Internal helpers ────────────────────────────────────────────

  /**
   * Confirm the token's authorised user still exists and hand the id back.
   *
   * This used to translate a User.id into the identity-provider subject the services
   * wanted. They want User.id now, so all that is left is the existence check
   * — worth keeping, because a token outliving its user should 404 rather
   * than fail deeper in a payload builder.
   */
  private async requireUser(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u.id;
  }

  // ─── Payload builders for each purpose ───────────────────────────

  private async buildOfferPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: resolved.targetId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            referenceNumber: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
        buyer: { select: { username: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer no longer exists');

    return {
      kind: resolved.purpose,
      expiresAt: resolved.expiresAt.toISOString(),
      offerExpiresAt: offer.expiresAt?.toISOString() ?? null,
      offerStatus: offer.status,
      greeting: user.firstName ?? user.username ?? 'there',
      listing: {
        id: offer.listing.id,
        title: offer.listing.title,
        listPrice: offer.listing.price,
        reference: offer.listing.referenceNumber,
        primaryImageUrl: offer.listing.images[0]?.url ?? null,
      },
      offer: {
        id: offer.id,
        amount: offer.offerAmount,
        counterAmount: offer.counterAmount,
        buyerUsername: offer.buyer?.username ?? 'a buyer',
        buyerNote: offer.buyerNote,
        sellerNote: offer.sellerNote,
      },
    };
  }

  private async buildAuctionPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    // For auctions, targetId = listingId. Use AuctionsService for
    // canonical state so the page matches the website's exact numbers.
    const listing = await this.prisma.listing.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        title: true,
        referenceNumber: true,
        status: true,
        endTime: true,
        currentBid: true,
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing no longer exists');

    // Fetch the canonical auction state from the service — gives us
    // nextMinBid, reserveMet etc. so the page matches the website's
    // numbers exactly.
    const state = await this.auctions
      .getAuctionState(resolved.targetId)
      .catch(() => null);

    return {
      kind: 'AUCTION_BID',
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      listing: {
        id: listing.id,
        title: listing.title,
        reference: listing.referenceNumber,
        primaryImageUrl: listing.images[0]?.url ?? null,
        status: listing.status,
        endTime: listing.endTime?.toISOString() ?? null,
        currentBid: listing.currentBid,
      },
      auction: state,
    };
  }

  // BIG-2 — the seller's "offer it to the runner-up?" page. targetId is the
  // EXPIRED listing; metadata carries the runner-up snapshot taken when the
  // SMS was sent. Both are re-validated in offerToRunnerUp at accept time, so
  // this payload is purely what the page needs to render the decision.
  private async buildRunnerUpPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        title: true,
        referenceNumber: true,
        status: true,
        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      },
    });
    if (!listing) throw new NotFoundException('Listing no longer exists');

    const meta = resolved.metadata ?? {};
    const runnerUpBidderId =
      typeof meta.runnerUpBidderId === 'string' ? meta.runnerUpBidderId : null;
    const amount =
      typeof meta.runnerUpAmount === 'number' ? meta.runnerUpAmount : null;

    // Show the bidder's USERNAME only — never their real name, same rule as
    // every other public-facing surface.
    const bidder = runnerUpBidderId
      ? await this.prisma.user.findUnique({
          where: { id: runnerUpBidderId },
          select: {
          username: true,
          isBanned: true,
          accountClosedAt: true,
          auctionStrikes: true,
        },
        })
      : null;

    // The window may have closed under the seller (they relisted, or the
    // bidder has since been banned/struck out). Tell the page so it renders
    // an explanation instead of a button that will just fail.
    // ⚠️ A CLOSED ACCOUNT CANNOT BE PROMOTED EITHER, and this path is the one
    // that reaches them without a login. Closure deletes their ActionTokens,
    // releases their phone and rewrites their email to an address that cannot
    // receive anything — so promoting one leaves the seller's auction sitting
    // in PAYMENT_PENDING for 24 hours waiting on somebody who was never told
    // and could not answer if they had been.
    const stillAvailable =
      listing.status === 'EXPIRED' &&
      !!bidder &&
      !bidder.isBanned &&
      !bidder.accountClosedAt &&
      bidder.auctionStrikes < 3 &&
      !!amount;

    return {
      kind: 'AUCTION_RUNNER_UP',
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      listing: {
        id: listing.id,
        title: listing.title,
        reference: listing.referenceNumber,
        primaryImageUrl: listing.images[0]?.url ?? null,
        status: listing.status,
      },
      runnerUp: {
        username: bidder?.username ?? null,
        amount,
      },
      stillAvailable,
    };
  }

  private async buildPrivateArrangeActionPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        orderReference: true,
        sellerId: true,
        buyerId: true,
        paymentStatus: true,
        paidAt: true,
        privateArrangeDeliveredAt: true,
        privateArrangeReceivedAt: true,
        listing: { select: { title: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction no longer exists');

    const role =
      resolved.metadata?.role === 'seller' ||
      resolved.metadata?.role === 'buyer'
        ? resolved.metadata.role
        : resolved.authorisedUserId === tx.sellerId
          ? 'seller'
          : 'buyer';
    if (
      (role === 'seller' && tx.sellerId !== resolved.authorisedUserId) ||
      (role === 'buyer' && tx.buyerId !== resolved.authorisedUserId)
    ) {
      throw new ForbiddenException('This link does not belong to you.');
    }

    return {
      kind: 'PRIVATE_ARRANGE_ACTION' as const,
      role,
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      transaction: {
        id: tx.id,
        orderReference: tx.orderReference,
        listingTitle: tx.listing.title,
        paymentStatus: tx.paymentStatus,
        paidAt: tx.paidAt?.toISOString() ?? null,
        deliveredAt: tx.privateArrangeDeliveredAt?.toISOString() ?? null,
        receivedAt: tx.privateArrangeReceivedAt?.toISOString() ?? null,
      },
    };
  }

  private async buildTransactionAcceptPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    // Seller-facing "I'll handle this sale" decision page. targetId =
    // transactionId. Surfaces buyer username, listing, price, accept
    // deadline so the seller can decide before tapping.
    const tx = await this.prisma.transaction.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        paidAt: true,
        acceptedAt: true,
        rejectedAt: true,
        acceptDeadlineAt: true,
        shippingMethod: true,
        deliveryOption: true,
        shippingProviderSlug: true,
        shippingServiceLevelCode: true,
        // The seller's own money. Without these the accept screen headlined
        // the BUYER's marked-up price as "Sale price" and showed no payout at
        // all - on the one screen where the seller decides to take the sale.
        listingPrice: true,
        commissionZar: true,
        processingFee: true,
        shippingCost: true,
        shippingHandlingCents: true,
        buyerTotal: true,
        sellerPayout: true,
        passFeeToBuyer: true,
        feeModel: true,
        listing: {
          select: {
            id: true,
            title: true,
            referenceNumber: true,
            price: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
        buyer: { select: { username: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction no longer exists');

    const pickupDates =
      tx.shippingMethod === 'COURIER'
        ? (() => {
            const service = resolveServiceLevel(
              tx.shippingProviderSlug,
              tx.shippingServiceLevelCode,
            );
            const soonest = soonestPickupDate(
              new Date(),
              cutoffHour(service.collectionCutoff),
            );
            return [soonest, nextPickupDay(soonest)];
          })()
        : [];

    return {
      kind: 'TRANSACTION_ACCEPT' as const,
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      transaction: {
        id: tx.id,
        paidAt: tx.paidAt?.toISOString() ?? null,
        acceptedAt: tx.acceptedAt?.toISOString() ?? null,
        rejectedAt: tx.rejectedAt?.toISOString() ?? null,
        acceptDeadlineAt: tx.acceptDeadlineAt?.toISOString() ?? null,
        shippingMethod: tx.shippingMethod,
        deliveryOption: tx.deliveryOption,
      },
      pickupDates,
      pickupWindows: [
        { key: 'SOONEST', label: 'Soonest', collectionWindow: null },
        { key: 'MORNING', label: '08:00–11:00', collectionWindow: '08:00-11:00' },
        { key: 'MIDDAY', label: '11:00–14:00', collectionWindow: '11:00-14:00' },
        { key: 'AFTERNOON', label: '14:00–17:00', collectionWindow: '14:00-17:00' },
      ],
      listing: {
        id: tx.listing.id,
        title: tx.listing.title,
        reference: tx.listing.referenceNumber,
        listPrice: tx.listing.price,
        primaryImageUrl: tx.listing.images[0]?.url ?? null,
      },
      // ⚠️ WHAT THE SELLER ACTUALLY GETS, from the one shared builder. This
      // page used to headline listing.price — the marked-up number the BUYER
      // pays — as though it were the seller's sale price, and showed no payout
      // at all. Under the markup model those differ by our whole margin, so
      // the figure the seller was deciding on was never theirs.
      money: sellerBreakdown(tx),
      buyerUsername: tx.buyer?.username ?? 'the buyer',
    };
  }

  private async buildDispatchPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    // For dispatch, targetId = transactionId. Surface enough that the
    // seller can confirm what they're dispatching at a glance + collect
    // the tracking reference for the buyer's status page.
    const tx = await this.prisma.transaction.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        paidAt: true,
        dispatchedAt: true,
        shippingMethod: true,
        trackingReference: true,
        listing: {
          select: {
            id: true,
            title: true,
            referenceNumber: true,
            price: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
        buyer: { select: { username: true } },
      },
    });
    if (!tx) throw new NotFoundException('Transaction no longer exists');

    return {
      kind: 'DISPATCH' as const,
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      transaction: {
        id: tx.id,
        paidAt: tx.paidAt?.toISOString() ?? null,
        dispatchedAt: tx.dispatchedAt?.toISOString() ?? null,
        shippingMethod: tx.shippingMethod,
        // If a previous attempt persisted a tracking reference (rare, but
        // possible if the cron retried), surface it as a default.
        existingTrackingReference: tx.trackingReference,
      },
      listing: {
        id: tx.listing.id,
        title: tx.listing.title,
        reference: tx.listing.referenceNumber,
        listPrice: tx.listing.price,
        primaryImageUrl: tx.listing.images[0]?.url ?? null,
      },
      buyerUsername: tx.buyer?.username ?? 'the buyer',
    };
  }

  private async buildCheckoutPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ): Promise<CheckoutResolvePayload> {
    // Two targets can carry a CHECKOUT link: a LISTING (auction winner / plain
    // Buy-Now checkout) and an OFFER (an accepted offer's pay-now link). The
    // offer branch exists because the bare /checkout/offer/<id> page requires
    // a session, so a signed-out buyer on the SMS link could not pay.
    if (resolved.targetType === 'offer') {
      const offer = await this.prisma.offer.findUnique({
        where: { id: resolved.targetId },
        select: {
          id: true,
          status: true,
          offerAmount: true,
          counterAmount: true,
          expiresAt: true,
          listing: {
            select: {
              id: true,
              title: true,
              price: true,
              referenceNumber: true,
              status: true,
              images: {
                where: { isPrimary: true },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      });
      if (!offer) throw new NotFoundException('Offer no longer exists');

      return {
        kind: 'CHECKOUT',
        expiresAt: resolved.expiresAt.toISOString(),
        greeting: user.firstName ?? user.username ?? 'there',
        listing: {
          id: offer.listing.id,
          title: offer.listing.title,
          listPrice: offer.listing.price,
          reference: offer.listing.referenceNumber,
          primaryImageUrl: offer.listing.images[0]?.url ?? null,
          status: offer.listing.status,
        },
        offer: {
          id: offer.id,
          amount: offer.offerAmount,
          counterAmount: offer.counterAmount,
          expiresAt: offer.expiresAt.toISOString(),
          status: offer.status,
        },
        // The offer checkout page carries the agreed amount; the token rides
        // along so that page can fetch /actions/<token>/offer-checkout.
        redirectTo: `/checkout/offer/${offer.id}?t=${resolved.token}`,
      };
    }

    // For checkout, targetId = listingId. The actual checkout UI lives
    // at /checkout/[listingId]?t=<token>. This payload just confirms
    // the redirect destination + provides listing snapshot for any
    // "preview" the frontend wants to show on /a/:token before bouncing.
    const listing = await this.prisma.listing.findUnique({
      where: { id: resolved.targetId },
      select: {
        id: true,
        title: true,
        price: true,
        referenceNumber: true,
        status: true,
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing no longer exists');

    return {
      kind: 'CHECKOUT',
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      listing: {
        id: listing.id,
        title: listing.title,
        listPrice: listing.price,
        reference: listing.referenceNumber,
        primaryImageUrl: listing.images[0]?.url ?? null,
        status: listing.status,
      },
      // Redirect URL the frontend should send the user to — keeps SMS
      // URLs short (always /a/<token>) while the actual checkout form
      // lives at the existing /checkout/[id] page.
      redirectTo: `/checkout/${listing.id}?t=${resolved.token}`,
    };
  }

  /**
   * The desktop-to-phone scan link.
   *
   * ⚠️ NO GREETING, unlike every other payload here. This one is opened by
   * pointing a camera at a QR code, which means it can be opened by whoever
   * is standing in the room — so it says nothing about who the member is
   * until the page behind it has done its own work.
   */
  private buildScanHandoffPayload(resolved: ResolvedToken) {
    // ⚠️ THE SERVER DECIDES WHERE THE FILES GO, and carries it on the URL so
    // the phone page needs no second round trip before it can open a camera.
    // A tampered query string can only redirect the upload to another of the
    // SAME member's destinations — every upload endpoint scopes by the
    // authorising user and would 404 on anybody else's — so this is a
    // convenience, not a trust boundary.
    //
    // ⚠️ WHICH HELD ONLY WHILE EVERY DESTINATION WAS ADDITIVE. 'kyc' is not:
    // it overwrites the one ID document the payout gate is decided on. So
    // KycScanController re-reads the token and refuses anything whose dest is
    // not 'kyc', and a mismatch counts toward the token's lock. Any future
    // destination that REPLACES rather than adds has to do the same — the
    // sentence above is about vaults, not about this line being safe by
    // itself.
    const meta = resolved.metadata ?? {};
    const q = new URLSearchParams({ t: resolved.token });
    if (typeof meta.dest === 'string') q.set('dest', meta.dest);
    if (typeof meta.motivationId === 'string') q.set('m', meta.motivationId);
    if (typeof meta.kind === 'string') q.set('kind', meta.kind);
    return {
      kind: 'SCAN_HANDOFF' as const,
      expiresAt: resolved.expiresAt.toISOString(),
      redirectTo: `/scan/handoff?${q.toString()}`,
    };
  }

  private buildKycVerifyPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    // KYC is about the user themselves — no offer/listing/tx to fetch.
    // Like CHECKOUT, we just hand the frontend a redirect target; the
    // verify page at /kyc/verify?t=<token> runs the VerifyNow flow with
    // the token authorising the (otherwise sign-in-gated) KYC endpoints.
    return {
      kind: 'KYC_VERIFY' as const,
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      redirectTo: `/kyc/verify?t=${resolved.token}`,
    };
  }

  // ─── Scan handoff (desktop → phone) ──────────────────────────────

  /**
   * The phone announcing that it has arrived.
   *
   * ⚠️ IT DOES NOT CONSUME. This is how the desktop's QR dialog learns it was
   * scanned, and it fires while the member is still holding the phone up —
   * consuming here would kill the token before a single photograph was taken.
   */
  @Post(':token/scan-handoff/open')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async scanHandoffOpen(@Param('token') token: string) {
    const resolved = await this.tokens.resolve(token);
    if (resolved.purpose !== 'SCAN_HANDOFF') {
      await this.tokens.markInvalid(token);
      throw new BadRequestException('This link is not a scanning link.');
    }
    await this.tokens.patchMetadata(token, {
      openedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  /**
   * The member saying they are finished on the phone.
   *
   * ⚠️ THE ONLY PATH THAT CONSUMES, and it must stay that way. It is called
   * from a deliberate button press, never from an unload handler or a
   * beacon — a token consumed by the phone locking its screen mid-session
   * would 410 the rest of the pack with nothing to show for it.
   */
  @Post(':token/scan-handoff/done')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async scanHandoffDone(@Param('token') token: string, @Req() req: Request) {
    const resolved = await this.tokens.resolve(token);
    if (resolved.purpose !== 'SCAN_HANDOFF') {
      await this.tokens.markInvalid(token);
      throw new BadRequestException('This link is not a scanning link.');
    }
    await this.tokens.consume(token, reqIp(req), reqUa(req));
    return { ok: true };
  }
}

/**
 * Pull caller IP from Express req. Trusts `app.set('trust proxy', 1)`
 * in main.ts — Express populates `req.ip` with the FIRST entry of the
 * single nginx hop's X-Forwarded-For. Manual X-Forwarded-For parsing
 * was removed because it bypassed the single-hop trust boundary and
 * let a client spoof upstream entries.
 */
function reqIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

function reqUa(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : '';
}
