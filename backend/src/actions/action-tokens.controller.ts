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
import { SwapProposalsService } from '../swaps/swap-proposals.service';
import { AuctionsService } from '../auctions/auctions.service';
import { TransactionsService } from '../payments/transactions.service';
import { SwapRole } from '@prisma/client';

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
    @Inject(forwardRef(() => SwapProposalsService))
    private readonly swaps: SwapProposalsService,
    @Inject(forwardRef(() => AuctionsService))
    private readonly auctions: AuctionsService,
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactions: TransactionsService,
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
      case 'AUCTION_RUNNER_UP':
        return this.buildRunnerUpPayload(resolved, user);
      case 'CHECKOUT':
        return this.buildCheckoutPayload(resolved, user);
      case 'KYC_VERIFY':
        return this.buildKycVerifyPayload(resolved, user);
      case 'DISPATCH':
        return this.buildDispatchPayload(resolved, user);
      case 'TRANSACTION_ACCEPT':
        return this.buildTransactionAcceptPayload(resolved, user);
      case 'SWAP_PROPOSAL_DECISION':
      case 'SWAP_COUNTER_DECISION':
        return this.buildSwapProposalPayload(resolved, user);
      default:
        throw new BadRequestException(`Unknown token purpose: ${resolved.purpose}`);
    }
  }

  // ─── Transaction accept (TOK-7 Phase 1) ─────────────────────────
  // Seller's one-tap "I will handle this sale" from the post-payment
  // SMS. Token authorisedUserId is the seller. 48h TTL.

  @Post(':token/accept-transaction')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptTransaction(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'TRANSACTION_ACCEPT',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.transactions.acceptTransaction(targetId, clerkId);
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.transactions.rejectTransaction(targetId, clerkId, reason);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // ─── Dispatch (TOK-7) ────────────────────────────────────────────
  // Seller's one-tap "mark dispatched" from the 48h nudge SMS. Token
  // authorisedUserId IS the seller. POST body provides tracking ref +
  // optional Pudo locker.

  @Post(':token/dispatch')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  dispatch(
    @Param('token') token: string,
    @Body() body: { trackingReference?: string; pudoDropoffLockerId?: string },
    @Req() req: Request,
  ) {
    const tracking = (body?.trackingReference ?? '').toString().trim();
    if (tracking.length === 0) {
      throw new BadRequestException('Tracking reference is required.');
    }
    if (tracking.length > 120) {
      throw new BadRequestException('Tracking reference too long (max 120).');
    }
    const locker = body?.pudoDropoffLockerId
      ? body.pudoDropoffLockerId.toString().trim().slice(0, 60) || undefined
      : undefined;
    return this.tokens.runAction(
      token,
      'DISPATCH',
      'transaction',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.transactions.confirmDispatch(targetId, clerkId, {
          trackingReference: tracking,
          pudoDropoffLockerId: locker,
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.accept(clerkId, targetId);
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
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.offers.reject(clerkId, targetId, body?.reason, body?.note);
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

  // ─── Swop / Trade actions (SWOP S2) ──────────────────────────────
  // Owner's one-tap decisions on a SWAP_PROPOSAL_DECISION token.

  @Post(':token/accept-swap')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptSwap(
    @Param('token') token: string,
    @Body() body: { firearmAttestation18Plus?: boolean },
    @Req() req: Request,
  ) {
    return this.tokens.runAction(
      token,
      'SWAP_PROPOSAL_DECISION',
      'swapProposal',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        // The owner accepts via SMS — carries the firearm 18+ attestation when
        // the offered item (which they receive) is a firearm.
        return this.swaps.acceptProposal(
          clerkId,
          targetId,
          body?.firearmAttestation18Plus,
        );
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/reject-swap')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectSwap(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'SWAP_PROPOSAL_DECISION',
      'swapProposal',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.swaps.reject(clerkId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/counter-swap')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  counterSwap(
    @Param('token') token: string,
    @Body()
    body: {
      cashAmount?: number;
      cashDirection?: string;
      note?: string;
      firearmAttestation18Plus?: boolean;
    },
    @Req() req: Request,
  ) {
    const cash = Number(body?.cashAmount);
    if (!Number.isFinite(cash) || cash < 0) {
      throw new BadRequestException('Counter cash amount required (cents, ≥ 0)');
    }
    const dir = body?.cashDirection;
    if (dir !== SwapRole.INITIATOR_GIVES && dir !== SwapRole.OWNER_GIVES) {
      throw new BadRequestException('Valid cash direction required');
    }
    return this.tokens.runAction(
      token,
      'SWAP_PROPOSAL_DECISION',
      'swapProposal',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.swaps.counter(clerkId, targetId, {
          counterCashAmount: Math.round(cash),
          counterCashDirection: dir,
          ownerNote: body?.note?.toString().slice(0, 1000),
          firearmAttestation18Plus: body?.firearmAttestation18Plus,
        });
      },
      reqIp(req),
      reqUa(req),
    );
  }

  // Proposer's one-tap decisions on a SWAP_COUNTER_DECISION token.

  @Post(':token/accept-swap-counter')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptSwapCounter(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'SWAP_COUNTER_DECISION',
      'swapProposal',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.swaps.acceptCounter(clerkId, targetId);
      },
      reqIp(req),
      reqUa(req),
    );
  }

  @Post(':token/reject-swap-counter')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rejectSwapCounter(@Param('token') token: string, @Req() req: Request) {
    return this.tokens.runAction(
      token,
      'SWAP_COUNTER_DECISION',
      'swapProposal',
      async ({ targetId, authorisedUserId }) => {
        const clerkId = await this.clerkIdFor(authorisedUserId);
        return this.swaps.rejectCounter(clerkId, targetId);
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

  private async buildSwapProposalPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    const proposal = await this.prisma.swapProposal.findUnique({
      where: { id: resolved.targetId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            referenceNumber: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        offeredListing: {
          select: {
            id: true,
            title: true,
            isFirearm: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        proposer: { select: { username: true } },
        owner: { select: { username: true } },
      },
    });
    if (!proposal) throw new NotFoundException('Swap proposal no longer exists');

    return {
      kind: resolved.purpose,
      expiresAt: resolved.expiresAt.toISOString(),
      proposalExpiresAt: proposal.expiresAt?.toISOString() ?? null,
      proposalStatus: proposal.status,
      greeting: user.firstName ?? user.username ?? 'there',
      // The listing the proposer WANTS (owner's item).
      wanted: {
        id: proposal.listing.id,
        title: proposal.listing.title,
        reference: proposal.listing.referenceNumber,
        primaryImageUrl: proposal.listing.images[0]?.url ?? null,
      },
      // The listing the proposer OFFERS (their item). The OWNER receives it —
      // isFirearm drives the SMS-page 18+ attestation requirement (S6).
      offered: {
        id: proposal.offeredListing.id,
        title: proposal.offeredListing.title,
        isFirearm: proposal.offeredListing.isFirearm,
        primaryImageUrl: proposal.offeredListing.images[0]?.url ?? null,
      },
      proposal: {
        id: proposal.id,
        proposerUsername: proposal.proposer?.username ?? 'a member',
        ownerUsername: proposal.owner?.username ?? 'the owner',
        cashAmount: proposal.cashAmount,
        // INITIATOR_GIVES = proposer pays the owner.
        cashFromProposer: proposal.cashDirection === SwapRole.INITIATOR_GIVES,
        counterCashAmount: proposal.counterCashAmount,
        counterCashFromProposer:
          proposal.counterCashDirection === SwapRole.INITIATOR_GIVES,
        proposerNote: proposal.proposerNote,
        ownerNote: proposal.ownerNote,
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
          select: { username: true, isBanned: true, auctionStrikes: true },
        })
      : null;

    // The window may have closed under the seller (they relisted, or the
    // bidder has since been banned/struck out). Tell the page so it renders
    // an explanation instead of a button that will just fail.
    const stillAvailable =
      listing.status === 'EXPIRED' &&
      !!bidder &&
      !bidder.isBanned &&
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
        pudoDropoffLockerId: true,
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
        // If a previous attempt persisted these fields (rare, but
        // possible if the cron retried), surface them as defaults.
        existingTrackingReference: tx.trackingReference,
        existingPudoDropoffLockerId: tx.pudoDropoffLockerId,
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

  private buildKycVerifyPayload(
    resolved: ResolvedToken,
    user: { username: string | null; firstName: string | null },
  ) {
    // KYC is about the user themselves — no offer/listing/tx to fetch.
    // Like CHECKOUT, we just hand the frontend a redirect target; the
    // verify page at /kyc/verify?t=<token> runs the VerifyNow flow with
    // the token authorising the (otherwise Clerk-gated) KYC endpoints.
    return {
      kind: 'KYC_VERIFY' as const,
      expiresAt: resolved.expiresAt.toISOString(),
      greeting: user.firstName ?? user.username ?? 'there',
      redirectTo: `/kyc/verify?t=${resolved.token}`,
    };
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
