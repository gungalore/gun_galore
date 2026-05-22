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
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActionTokensService,
  ActionTokenPurpose,
  ResolvedToken,
} from './action-tokens.service';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';

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
 *   2. Looks up the authorisedUserId → clerkId (so we can call the
 *      existing ClerkGuard-style services without modifying them)
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

    // Fetch the user (need username for greeting + clerkId for downstream)
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
      case 'CHECKOUT':
        return this.buildCheckoutPayload(resolved, user);
      default:
        throw new BadRequestException(`Unknown token purpose: ${resolved.purpose}`);
    }
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.accept(clerkId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/reject-offer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectOffer(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'OFFER_DECISION',
      'offer',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.reject(clerkId, targetId);
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.counter(clerkId, targetId, {
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.acceptCounter(clerkId, targetId);
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.rejectCounter(clerkId, targetId);
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.auctions.placeBid(clerkId, targetId, {
          maxAmount: Math.round(maxAmount),
          isOneShot,
        });
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Internal helpers ────────────────────────────────────────────

  /** Look up a User.id → clerkId. Throws if user not found. */
  private async clerkIdFor(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clerkId: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u.clerkId;
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

  private async buildCheckoutPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
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
}

/** Pull caller IP from Express req — handles proxy headers safely. */
function reqIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() ?? '';
  if (Array.isArray(fwd)) return fwd[0]?.split(',')[0]?.trim() ?? '';
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

function reqUa(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : '';
}
