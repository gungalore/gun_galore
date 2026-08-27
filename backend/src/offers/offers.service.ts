import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { ActivityService } from '../activity/activity.service';
import {
  OFFER_REJECT_REASONS,
  OFFER_REASON_LABEL,
  type OfferRejectReason,
  consequencesForOfferReject,
  applySellerRejectPenalty,
} from '../common/seller-reject-policy';
import { assertAccountNotClosed } from '../common/account-standing';
import { ActionTokensService } from '../actions/action-tokens.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { OfferStatus } from '@prisma/client';

const OFFER_TTL_HOURS = 48;
// ⚠️ Frontend copy mirrors this value — keep in sync when changing:
//   frontend/app/my/offers/page.tsx ("24 hours to act on a counter" +
//   the ExpiryCountdown on COUNTERED cards).
const COUNTER_TTL_HOURS = 24;
const CHECKOUT_TTL_HOURS = 24;
// eBay-style attempt cap — a buyer gets this many offers per listing
// across the row's lifetime (re-offers re-use the row; see submit()).
const MAX_OFFER_ATTEMPTS = 5;
// Lazy getter — must NOT be a module-level constant. ES module imports
// hoist before main.ts's dotenv.config() runs, so a top-level
// `const APP_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'`
// captures `undefined` and falls back to localhost. Every SMS token URL
// then breaks for live users. Calling the function at use-time defers
// the env read until after dotenv has populated process.env.
const APP_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:3000';

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly contactFilter: ContactDetailFilterService,
    // ActionTokensService is @Global so no module-level import
    // needed — we mint OFFER_DECISION / COUNTER_DECISION / CHECKOUT
    // tokens at the moment each notification fires so the recipient
    // can act from the SMS link without signing in.
    private readonly actionTokens: ActionTokensService,
    private readonly activity: ActivityService,
  ) {}

  // ----------------------------------------------------------------
  // Submit an offer (buyers only, one per listing)
  // ----------------------------------------------------------------
  async submit(buyerClerkId: string, dto: CreateOfferDto) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) throw new ForbiddenException('User not found');
    // ⚠️ Closed is checked BEFORE banned: a member who closed their own
    // account and came back to a stale tab must not be told they were
    // suspended. See common/account-standing.ts.
    assertAccountNotClosed(buyer);
    if (buyer.isBanned) throw new ForbiddenException('Account is suspended');
    // An accepted offer is a commitment to pay — the same 3-strike
    // non-payment gate the auction engine enforces applies here.
    if (buyer.auctionStrikes >= 3) {
      throw new ForbiddenException(
        'Offers suspended — three strikes for non-payment',
      );
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      include: { seller: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE') throw new BadRequestException('Listing is no longer available');
    // ⚠️ THIS USED TO BE `listingType !== 'TAKE_A_SHOT'`. Offers are no longer
    // a listing TYPE — they are a flag any Buy Now or Auction listing can
    // carry (operator, 2026-08-27), so the gate is the seller's own choice on
    // this listing rather than which of three modes they picked at creation.
    if (!listing.acceptsOffers) {
      throw new BadRequestException('This listing is not accepting offers.');
    }
    if (listing.sellerId === buyer.id) throw new BadRequestException('Sellers cannot offer on their own listings');
    // Listing-banned seller (3 reject strikes): their ACTIVE listings were
    // cancelled at ban time, so this gate is defence-in-depth for any
    // listing that raced the ban. Buyer-facing copy stays neutral.
    if (listing.seller.sellingBannedAt) {
      throw new BadRequestException(
        'This seller is not accepting offers at the moment.',
      );
    }

    // Single-promise rule: once ANY offer on this listing is ACCEPTED
    // the item is spoken for (buyer has a live pay window) — no new
    // offers until that resolves (payment converts it; a lapse frees it).
    const siblingAccepted = await this.prisma.offer.findFirst({
      where: { listingId: listing.id, status: OfferStatus.ACCEPTED },
      select: { id: true },
    });
    if (siblingAccepted) {
      throw new BadRequestException(
        'The seller has already accepted another offer on this item.',
      );
    }

    // One offer ROW per buyer per listing (@@unique). Re-offers after a
    // close re-use the row (audit identity preserved) and are capped.
    const existing = await this.prisma.offer.findUnique({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: buyer.id } },
    });
    if (existing && !['REJECTED', 'WITHDRAWN', 'EXPIRED'].includes(existing.status)) {
      throw new BadRequestException('You already have an active offer on this listing');
    }
    if (existing && existing.attemptCount >= MAX_OFFER_ATTEMPTS) {
      throw new BadRequestException(
        `You've reached the limit of ${MAX_OFFER_ATTEMPTS} offers on this listing.`,
      );
    }

    // Contact-detail filter on the optional buyer note — the seller
    // sees this note verbatim in their offer-received email, so it's a
    // prime channel for "WhatsApp me on 082..." fee-bypass attempts.
    // We reject before any DB write or notification. clerkId is passed
    // so the filter can persist the rejection against this user for
    // the T&S queue + repeat-offender tracking.
    if (dto.buyerNote) {
      const check = await this.contactFilter.check(
        dto.buyerNote,
        'offer-note',
        buyerClerkId,
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    // Lowball filter — at/below the seller's auto-decline threshold the
    // offer is recorded as instantly REJECTED (it still consumes an
    // attempt, so threshold-probing burns the 5-offer cap) and the buyer
    // is notified. The seller is deliberately NOT notified — sparing
    // them lowball noise is the whole point of the threshold.
    const autoDecline =
      listing.autoDeclineThreshold !== null &&
      dto.offerAmount <= listing.autoDeclineThreshold;

    // Auto-accept if offer meets the threshold
    const autoAccept =
      !autoDecline &&
      listing.autoAcceptThreshold !== null &&
      dto.offerAmount >= listing.autoAcceptThreshold;

    // Threshold-meeting offers still go to the seller as PENDING — see the
    // metAutoAccept comment below. Only auto-DECLINE short-circuits.
    const status = autoDecline ? OfferStatus.REJECTED : OfferStatus.PENDING;
    const expiresAt = new Date(Date.now() + OFFER_TTL_HOURS * 3_600_000);

    // Fresh round on the same row (attempt counted) or a first offer.
    const offer = existing
      ? await this.prisma.offer.update({
          where: { id: existing.id },
          data: {
            offerAmount: dto.offerAmount,
            buyerNote: dto.buyerNote ?? null,
            // Clear the previous round's counter so stale seller terms
            // never leak into this round.
            counterAmount: null,
            sellerNote: null,
            status,
            expiresAt,
            metAutoAccept: autoAccept,
            rejectReason: null,
            rejectNote: null,
            // Fresh window → fresh reminder eligibility.
            sellerRemindedAt: null,
            buyerPayRemindedAt: null,
            attemptCount: { increment: 1 },
          },
        })
      : await this.prisma.offer.create({
          data: {
            listingId: listing.id,
            buyerId: buyer.id,
            offerAmount: dto.offerAmount,
            buyerNote: dto.buyerNote,
            status,
            expiresAt,
            metAutoAccept: autoAccept,
          },
        });

    this.activity.record({
      eventType: 'offer_placed',
      actor: { userId: buyer.id },
      listingId: listing.id,
      amountCents: dto.offerAmount,
      metadata: { status },
    });

    if (autoDecline) {
      void this.notifyBuyerOfReject(offer.id);
      return { offer, autoAccepted: false, autoDeclined: true };
    }
    // Operator decision 2026-07-23: an offer that meets the auto-accept
    // threshold is NO LONGER accepted instantly — the seller always makes
    // the final call. The threshold now only (a) flags the offer
    // (metAutoAccept, snapshotted at submit) so the seller notification is
    // louder, and (b) makes a later OFFER_TOO_LOW rejection penalty-bearing
    // (the seller set that price themselves).
    void this.notifySellerOfOffer(offer.id, autoAccept);
    return { offer, autoAccepted: false, meetsAutoAccept: autoAccept };
  }

  // ----------------------------------------------------------------
  // Seller accepts the original offer
  // ----------------------------------------------------------------
  async accept(sellerClerkId: string, offerId: string) {
    const { offer, listing } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }
    // M8 — re-check listing status at accept time. The listing could
    // have sold via another offer or buy-now since the seller saw their
    // SMS/notification. Without this, the seller would "accept" an
    // offer on a gone item and the buyer would get a misleading
    // "accepted — pay now" SMS that fails later at the reserve step.
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException(
        'This listing is no longer available — it may already have sold or been cancelled.',
      );
    }

    // Single-promise rule: refuse to accept when ANOTHER offer on this
    // listing is already ACCEPTED (its buyer holds a live pay window) —
    // otherwise two buyers get "pay now" promises for one item.
    const siblingAccepted = await this.prisma.offer.findFirst({
      where: {
        listingId: listing.id,
        id: { not: offerId },
        status: OfferStatus.ACCEPTED,
      },
      select: { id: true },
    });
    if (siblingAccepted) {
      throw new BadRequestException(
        'You have already accepted another offer on this listing — wait for that buyer to pay or for their window to lapse.',
      );
    }

    // Atomic guard: include status=PENDING in the WHERE clause so a
    // concurrent counter() / reject() cannot interleave between the
    // read above and this write. If another transition already won,
    // updateMany returns count=0 and we surface the same error.
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });
    if (guard.count === 0) {
      throw new BadRequestException('Offer is no longer pending');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    // The item is promised to this buyer — decline every other open
    // offer on the listing (eBay behaviour) so no rival buyer is left
    // dangling on an item that's effectively sold.
    void this.declineSiblings(listing.id, offerId);
    void this.notifyBuyerOfAccept(offerId);
    // Resolve the seller's "offer received" notification — they just
    // acted on it. The new "offer accepted" row that fires for the
    // buyer is action-required (buyer must pay) and isn't cleared
    // here; TransactionsService.payOffer handles that one.
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Seller rejects the offer
  // ----------------------------------------------------------------
  async reject(
    sellerClerkId: string,
    offerId: string,
    reasonRaw?: string,
    noteRaw?: string,
  ) {
    const { offer, listing } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }

    // Structured reason is REQUIRED (operator policy 2026-07-23): the
    // ticklist choice determines whether the rejection is penalty-bearing.
    const reason = (reasonRaw ?? '').trim().toUpperCase() as OfferRejectReason;
    if (!OFFER_REJECT_REASONS.includes(reason)) {
      throw new BadRequestException('Please choose a reason for declining.');
    }
    const note = (noteRaw ?? '').trim();
    if (reason === 'OTHER' && note.length < 10) {
      throw new BadRequestException(
        'Please describe your reason (at least 10 characters).',
      );
    }

    // Atomic guard (same pattern as accept) — a concurrent accept /
    // withdraw / expiry between the read and this write must not be
    // silently overwritten with REJECTED.
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.REJECTED,
        rejectReason: reason,
        rejectNote: note || null,
      },
    });
    if (guard.count === 0) {
      throw new BadRequestException('Offer is no longer pending');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    // Penalty per the FIRM policy — awaited so the seller's response can
    // carry the strike feedback ("strike 2 of 3"), but failure never blocks
    // the rejection (the buyer notification below still fires).
    let penalty = { struck: false, totalStrikes: 0, banned: false, delisted: false };
    try {
      penalty = await applySellerRejectPenalty(this.prisma, {
        sellerId: listing.sellerId,
        source: 'OFFER',
        reason,
        consequences: consequencesForOfferReject(reason, offer.metAutoAccept),
        listingId: listing.id,
        referenceId: offerId,
        note: note || null,
      });
      if (penalty.struck) {
        this.logger.warn(
          `Seller ${listing.sellerId} reject strike (${reason}, offer ${offerId}) — total ${penalty.totalStrikes}${penalty.banned ? ' — SELLING BANNED' : ''}`,
        );
      }
    } catch (err) {
      this.logger.warn(`reject penalty failed: ${(err as Error).message}`);
    }

    void this.notifyBuyerOfReject(offerId);
    // Seller resolved their "offer received". Buyer's new
    // "offer rejected" row is dismissible — they handle it themselves.
    void this.notifications.resolveByEntity('offer', offerId);
    return {
      ...updated,
      strike: penalty.struck,
      strikes: penalty.totalStrikes,
      sellingBanned: penalty.banned,
    };
  }

  // ----------------------------------------------------------------
  // Seller counters — one counter per offer lifetime
  // ----------------------------------------------------------------
  async counter(sellerClerkId: string, offerId: string, dto: CounterOfferDto) {
    const { offer } = await this.loadOfferForSeller(sellerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Offer is not pending');
    }
    if (offer.counterAmount !== null) {
      throw new BadRequestException('Seller can only counter once per offer');
    }
    // Logical sanity: a counter below the buyer's own offer is a
    // nonsense state, and a counter AT their offer is just an accept.
    if (dto.counterAmount <= offer.offerAmount) {
      throw new BadRequestException(
        'A counter-offer must be higher than the buyer’s offer — if you’re happy with their price, use Accept.',
      );
    }

    // Contact-detail filter on the seller's counter-note — buyer sees
    // this verbatim in their counter-offer notification, so it's the
    // mirror-image of the buyer-side note risk.
    if (dto.sellerNote) {
      const check = await this.contactFilter.check(
        dto.sellerNote,
        'counter-note',
        sellerClerkId,
      );
      if (!check.allowed) {
        throw new BadRequestException(check.reason);
      }
    }

    // Atomic guard — must not overwrite a concurrent accept/withdraw/
    // expiry with a counter (the buyer could be holding a pay-now token
    // for an ACCEPTED offer this write would silently flip back).
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.PENDING, counterAmount: null },
      data: {
        counterAmount: dto.counterAmount,
        sellerNote: dto.sellerNote,
        status: OfferStatus.COUNTERED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });
    if (guard.count === 0) {
      throw new BadRequestException('Offer is no longer pending');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    void this.notifyBuyerOfCounter(offerId);
    // Seller resolved their "offer received". Buyer's new
    // "offer countered" row is action-required (buyer must respond)
    // and stays open until they accept/reject the counter.
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer accepts the seller's counter
  // ----------------------------------------------------------------
  async acceptCounter(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.COUNTERED) {
      throw new BadRequestException('No counter to accept');
    }

    // Single-promise rule (mirrors accept()) — if another offer on the
    // listing is already ACCEPTED, this counter is a dead end; give the
    // buyer a clean error instead of a second pay-now promise.
    const siblingAccepted = await this.prisma.offer.findFirst({
      where: {
        listingId: offer.listingId,
        id: { not: offerId },
        status: OfferStatus.ACCEPTED,
      },
      select: { id: true },
    });
    if (siblingAccepted) {
      throw new BadRequestException(
        'The seller has already accepted another offer on this item.',
      );
    }

    // Atomic guard (mirrors accept()): include status=COUNTERED in the WHERE
    // clause so a concurrent rejectCounter() / expiry cron cannot interleave
    // between the read above and this write. If another transition already
    // won, updateMany returns count=0 and we surface the same error.
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.COUNTERED },
      data: {
        status: OfferStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });
    if (guard.count === 0) {
      throw new BadRequestException('No counter to accept');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    // Item promised to this buyer — close out every other open offer.
    void this.declineSiblings(offer.listingId, offerId);

    void this.notifySellerOfCounterAccepted(offerId);
    // FLOW-F5 — the buyer accepted the seller's counter, so the AGREED price
    // is now the counter amount. Mint the buyer a CHECKOUT token + send the
    // "pay now" link exactly like the seller-accept path (notifyBuyerOfAccept)
    // — previously acceptCounter told the seller but never handed the buyer a
    // way to pay (the promised payment link was never sent).
    void this.notifyBuyerOfCounterAccept(offerId);
    // Buyer resolved their "offer countered". Seller's new
    // counterAccepted row is dismissible (buyer will pay next).
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer rejects the counter — offer closes
  // ----------------------------------------------------------------
  async rejectCounter(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.COUNTERED) {
      throw new BadRequestException('No counter to reject');
    }

    // Atomic guard — mirrors acceptCounter.
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.COUNTERED },
      data: { status: OfferStatus.REJECTED },
    });
    if (guard.count === 0) {
      throw new BadRequestException('No counter to reject');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    void this.notifySellerOfCounterRejected(offerId);
    // Buyer resolved their "offer countered". Seller's new
    // counterRejected row is dismissible (final state).
    void this.notifications.resolveByEntity('offer', offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Buyer withdraws (only while PENDING)
  // ----------------------------------------------------------------
  async withdraw(buyerClerkId: string, offerId: string) {
    const { offer } = await this.loadOfferForBuyer(buyerClerkId, offerId);
    if (offer.status !== OfferStatus.PENDING) {
      throw new BadRequestException('Cannot withdraw — offer is no longer pending');
    }

    // Atomic guard — without it a withdraw racing the seller's accept
    // could overwrite ACCEPTED with WITHDRAWN while the buyer holds a
    // freshly-minted pay-now token.
    const guard = await this.prisma.offer.updateMany({
      where: { id: offerId, status: OfferStatus.PENDING },
      data: { status: OfferStatus.WITHDRAWN },
    });
    if (guard.count === 0) {
      throw new BadRequestException('Cannot withdraw — offer is no longer pending');
    }
    const updated = await this.prisma.offer.findUnique({ where: { id: offerId } });

    // Clear the seller's action-required "offer received" bell (it was
    // left lit before — sellers clicked through to an offer that no
    // longer existed) and tell them the buyer withdrew.
    void this.notifications.resolveByEntity('offer', offerId);
    void this.notifySellerOfWithdrawal(offerId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Queries
  // ----------------------------------------------------------------
  async getMyOffers(buyerClerkId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) return [];
    return this.prisma.offer.findMany({
      where: { buyerId: buyer.id },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            images: { where: { isPrimary: true }, take: 1 },
            // Public-facing — username only, no real name.
            seller: { select: { username: true, clerkId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReceivedOffers(sellerClerkId: string) {
    const seller = await this.prisma.user.findUnique({ where: { clerkId: sellerClerkId } });
    if (!seller) return [];
    return this.prisma.offer.findMany({
      where: { listing: { sellerId: seller.id } },
      include: {
        listing: { select: { id: true, title: true } },
        // Seller side viewing the buyer who made an offer — username
        // only. Buyer identity stays private until checkout completes.
        buyer: { select: { username: true, clerkId: true, totalSales: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(clerkId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            autoAcceptThreshold: true,
            passFeeToBuyer: true,
            // isFirearm + shippingMethods drive the offer-checkout form:
            // a firearm offer MUST route DEALER_TRANSFER (the form hides
            // courier options + shows the SAPS consent). Without these the
            // page passed isFirearm=false and firearm buyers were
            // hard-rejected at submit with no path to complete.
            isFirearm: true,
            shippingMethods: true,
            // Vicinity for the offer checkout's pre-payment acknowledgement.
            // An accepted offer is still a purchase, so the buyer must be told
            // where the item is on this path too — and the tick asks them to
            // confirm they were. Town/province only; never the street.
            province: true,
            publicLocality: true,
            plannedDealerLocation: true,
            // Seller email retained — only seller themselves sees
            // their own email via this endpoint (gated by isSeller
            // check below). Username is the public handle.
            seller: { select: { clerkId: true, username: true, email: true } },
          },
        },
        buyer: { select: { clerkId: true, username: true } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException();

    const isBuyer = offer.buyerId === user.id;
    const isSeller = offer.listing.seller.clerkId === clerkId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Access denied');

    // The auto-accept threshold is the seller's PRIVATE negotiating
    // floor — leaking it to the buyer lets them bid exactly that number
    // every time. Only the seller sees it on this endpoint.
    if (!isSeller) {
      offer.listing.autoAcceptThreshold = null;
    }

    // PRIVATE_ARRANGE is legal only for firearms (SAPS inter-dealer
    // peer transfer). Strip it from the offer-checkout options on
    // non-firearm listings so the buyer never sees a method the
    // transaction layer would reject at submit (validateShipping).
    if (!offer.listing.isFirearm && Array.isArray(offer.listing.shippingMethods)) {
      offer.listing.shippingMethods = offer.listing.shippingMethods.filter(
        (m) => m !== 'PRIVATE_ARRANGE',
      );
    }

    return offer;
  }

  // ----------------------------------------------------------------
  // Cron helper — expire stale offers
  // ----------------------------------------------------------------
  async expireStale() {
    // Per-row (guarded) instead of one bulk update — expiries used to be
    // completely SILENT: an accepted sale could evaporate with no word
    // to the seller, no word to the buyer, and no non-payment
    // consequence. Each lapse now notifies the right party and an
    // accepted-but-unpaid lapse strikes the buyer (same commitment rule
    // as unpaid auction wins).
    const now = new Date();
    const stale = await this.prisma.offer.findMany({
      where: {
        status: { in: [OfferStatus.PENDING, OfferStatus.COUNTERED, OfferStatus.ACCEPTED] },
        expiresAt: { lt: now },
      },
      select: { id: true, status: true, buyerId: true, listingId: true },
      take: 200,
    });
    let expired = 0;
    for (const o of stale) {
      // Guarded flip — a decision landing mid-sweep wins over the expiry.
      const claim = await this.prisma.offer.updateMany({
        where: { id: o.id, status: o.status, expiresAt: { lt: now } },
        data: { status: OfferStatus.EXPIRED },
      });
      if (claim.count === 0) continue;
      expired += 1;
      // Clear any still-open action-required inbox rows on this offer.
      void this.notifications.resolveByEntity('offer', o.id);
      if (o.status === OfferStatus.PENDING) {
        // Seller never responded within 48h — tell the buyer AND the
        // seller (who lost a real sale and was previously never told).
        void this.notifyOfferExpired(o.id);
        void this.notifyOfferExpiredSeller(o.id);
      } else if (o.status === OfferStatus.COUNTERED) {
        // Buyer never answered the counter — tell the seller.
        void this.notifyCounterExpired(o.id);
      } else {
        // ACCEPTED lapsed: buyer blew the 24h pay window. Tell both
        // sides and strike the buyer.
        void this.notifyAcceptedLapsed(o.id);
        void this.strikeUnpaidOfferBuyer(o.buyerId, o.listingId);
      }
    }
    if (expired > 0) this.logger.log(`Expired ${expired} offer(s)`);
  }

  // Nudge before an offer lapses — nobody should be struck (or lose a sale)
  // for missing a deadline they were never reminded of. Two passes, both
  // one-shot per row via a CAS-claimed guard column:
  //   • PENDING offers expiring within 12h → remind the SELLER (reuse the
  //     OFFER_DECISION token so the SMS stays one-tap).
  //   • ACCEPTED offers expiring within 6h → remind the BUYER to pay (reuse
  //     a fresh CHECKOUT token) before the unpaid lapse strikes them.
  // Run from the same 10-min cron slot as expireStale.
  async remindExpiring() {
    const now = new Date();
    let reminded = 0;

    // ── Seller: PENDING offer about to lapse ──────────────────────
    const pendingSoon = await this.prisma.offer.findMany({
      where: {
        status: OfferStatus.PENDING,
        sellerRemindedAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + 12 * 3600_000) },
      },
      select: { id: true, expiresAt: true },
      take: 100,
    });
    for (const o of pendingSoon) {
      // CAS-claim the reminder so overlapping runs can't double-send.
      const claim = await this.prisma.offer.updateMany({
        where: { id: o.id, status: OfferStatus.PENDING, sellerRemindedAt: null },
        data: { sellerRemindedAt: now },
      });
      if (claim.count === 0) continue;
      reminded += 1;
      void this.remindSellerOfferExpiring(o.id);
    }

    // ── Buyer: ACCEPTED offer, pay window about to lapse ──────────
    const acceptedSoon = await this.prisma.offer.findMany({
      where: {
        status: OfferStatus.ACCEPTED,
        buyerPayRemindedAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + 6 * 3600_000) },
      },
      select: { id: true },
      take: 100,
    });
    for (const o of acceptedSoon) {
      const claim = await this.prisma.offer.updateMany({
        where: {
          id: o.id,
          status: OfferStatus.ACCEPTED,
          buyerPayRemindedAt: null,
        },
        data: { buyerPayRemindedAt: now },
      });
      if (claim.count === 0) continue;
      reminded += 1;
      void this.remindBuyerToPay(o.id);
    }

    if (reminded > 0) this.logger.log(`Reminded on ${reminded} expiring offer(s)`);
    return { reminded };
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------
  private async loadOfferForSeller(sellerClerkId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { listing: { include: { seller: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.listing.seller.clerkId !== sellerClerkId) throw new ForbiddenException('Access denied');
    return { offer, listing: offer.listing };
  }

  private async loadOfferForBuyer(buyerClerkId: string, offerId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId: buyerClerkId } });
    if (!buyer) throw new ForbiddenException();
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { listing: { include: { seller: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.buyerId !== buyer.id) throw new ForbiddenException('Access denied');
    return { offer, listing: offer.listing };
  }

  // The item was promised to one buyer — decline every other open offer
  // (PENDING or COUNTERED) on the listing and tell each losing buyer.
  // eBay behaviour; without it rival buyers dangled on an effectively
  // sold item. Best-effort: a failure here never blocks the accept.
  private async declineSiblings(listingId: string, keptOfferId: string) {
    try {
      const siblings = await this.prisma.offer.findMany({
        where: {
          listingId,
          id: { not: keptOfferId },
          status: { in: [OfferStatus.PENDING, OfferStatus.COUNTERED] },
        },
        select: { id: true },
      });
      if (siblings.length === 0) return;
      await this.prisma.offer.updateMany({
        where: {
          id: { in: siblings.map((s) => s.id) },
          status: { in: [OfferStatus.PENDING, OfferStatus.COUNTERED] },
        },
        data: { status: OfferStatus.REJECTED },
      });
      for (const s of siblings) {
        void this.notifications.resolveByEntity('offer', s.id);
        void this.notifyBuyerOfReject(s.id);
      }
    } catch (err) {
      this.logger.warn(
        `declineSiblings failed for listing ${listingId}: ${(err as Error).message}`,
      );
    }
  }

  // Accepted-offer pay window lapsed — record a non-payment strike
  // against the buyer (same counter + admin-alert pattern as unpaid
  // auction wins; the submit()/placeBid gates read the same field).
  private async strikeUnpaidOfferBuyer(buyerId: string, listingId: string) {
    try {
      const after = await this.prisma.user.update({
        where: { id: buyerId },
        data: { auctionStrikes: { increment: 1 }, lastStrikeAt: new Date() },
        select: { auctionStrikes: true, username: true },
      });
      if (after.auctionStrikes >= 3) {
        await this.prisma.adminAlert
          .create({
            data: {
              type: 'BIDDER_AUCTION_STRIKES_THRESHOLD',
              referenceId: buyerId,
              urgent: true,
              context: `Buyer @${after.username ?? buyerId} hit ${after.auctionStrikes} unpaid-commitment strikes (latest: accepted offer on listing ${listingId} never paid) — review for suspension.`,
            },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(
        `strikeUnpaidOfferBuyer failed for ${buyerId}: ${(err as Error).message}`,
      );
    }
  }

  // Seller notice for an auto-accepted offer — their threshold just
  // sold the item and the buyer has 24h to pay. Previously silent.
  // (notifySellerOfAutoAccept removed 2026-07-23 — auto-accept no longer
  // exists as an instant acceptance; qualifying offers go through
  // notifySellerOfOffer with meetsAutoAccept=true instead.)

  private async notifySellerOfWithdrawal(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.offerWithdrawn({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfWithdrawal failed: ${(err as Error).message}`);
    }
  }

  private async notifyOfferExpired(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer) return;
      await this.notifications.offerExpiredBuyer({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifyOfferExpired failed: ${(err as Error).message}`);
    }
  }

  private async notifyCounterExpired(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.counterExpiredSeller({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        buyerName: offer.buyer.username ?? 'The buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifyCounterExpired failed: ${(err as Error).message}`);
    }
  }

  // A PENDING offer lapsed unanswered — tell the SELLER (buyer is told
  // separately by notifyOfferExpired). Best-effort.
  private async notifyOfferExpiredSeller(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.offerExpiredSeller({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
        offerAmount: offer.offerAmount,
      });
    } catch (err) {
      this.logger.error(`notifyOfferExpiredSeller failed: ${(err as Error).message}`);
    }
  }

  // ~12h-to-lapse reminder to the seller on a PENDING offer. Mints a fresh
  // OFFER_DECISION token (offer.expiresAt TTL) so the SMS stays one-tap.
  private async remindSellerOfferExpiring(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer || offer.status !== OfferStatus.PENDING) return;
      const hoursLeft = Math.max(
        1,
        Math.round((offer.expiresAt.getTime() - Date.now()) / 3_600_000),
      );
      const token = await this.actionTokens
        .mint({
          purpose: 'OFFER_DECISION',
          targetType: 'offer',
          targetId: offer.id,
          authorisedUserId: offer.listing.sellerId,
          expiresAt: offer.expiresAt,
        })
        .catch(() => null);
      await this.notifications.offerExpiryReminderSeller({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        sellerPhone: offer.listing.seller.phone,
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
        offerAmount: offer.offerAmount,
        hoursLeft,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`remindSellerOfferExpiring failed: ${(err as Error).message}`);
    }
  }

  // ~6h-to-lapse pay reminder to the buyer on an ACCEPTED offer. Mints a
  // fresh CHECKOUT token so the SMS deep-links to checkout.
  private async remindBuyerToPay(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer || offer.status !== OfferStatus.ACCEPTED) return;
      const amount = offer.counterAmount ?? offer.offerAmount;
      const hoursLeft = Math.max(
        1,
        Math.round((offer.expiresAt.getTime() - Date.now()) / 3_600_000),
      );
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: offer.listing.id,
          authorisedUserId: offer.buyerId,
          expiresAt: offer.expiresAt,
          metadata: { offerId: offer.id, agreedAmount: amount },
        })
        .catch(() => null);
      await this.notifications.offerPayReminderBuyer({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
        amount,
        hoursLeft,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`remindBuyerToPay failed: ${(err as Error).message}`);
    }
  }

  private async notifyAcceptedLapsed(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.acceptedOfferLapsed({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        sellerPhone: offer.listing.seller.phone,
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        amount: offer.counterAmount ?? offer.offerAmount,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifyAcceptedLapsed failed: ${(err as Error).message}`);
    }
  }

  private async notifySellerOfOffer(offerId: string, meetsAutoAccept = false) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: {
          listing: { include: { seller: true } },
          buyer: true,
        },
      });
      if (!offer) return;
      // Mint an OFFER_DECISION token so the seller can accept /
      // reject / counter straight from the SMS link without
      // signing in. Token expires when the offer does.
      const token = await this.actionTokens
        .mint({
          purpose: 'OFFER_DECISION',
          targetType: 'offer',
          targetId: offer.id,
          authorisedUserId: offer.listing.sellerId,
          expiresAt: offer.expiresAt ?? new Date(Date.now() + OFFER_TTL_HOURS * 3600_000),
        })
        .catch((err) => {
          this.logger.warn(`OFFER_DECISION token mint failed: ${(err as Error).message}`);
          return null;
        });
      // ⚠️ THE OFFER IS ALREADY WRITTEN AND STAYS WRITTEN. This gate silences a
      // ping, nothing more: the offer exists, the seller sees it in their own
      // lists, and the 48-hour clock runs either way. A seller who lists twenty
      // items and welcomes offers on all of them may still not want twenty
      // notifications (operator, 2026-08-27) — but muting a channel must never
      // quietly discard someone's offer.
      if (offer.listing.seller.notifyOffersEnabled === false) {
        this.logger.log(
          `offer ${offer.id}: seller has offer notifications off — recorded, not announced`,
        );
      } else {
      await this.notifications.offerReceived({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        sellerPhone: offer.listing.seller.phone,
        // POPIA + platform policy: show the buyer's @username to the
        // seller, never their real legal name. The full name is only
        // revealed post-payment for shipping where legally required.
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerAmount: offer.offerAmount,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
        meetsAutoAccept,
      });
      }
    } catch (err) {
      this.logger.error(`notifySellerOfOffer failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfAccept(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer) return;
      // Offer accepted → mint a CHECKOUT token for the buyer so the
      // SMS link drops them straight on the checkout page (no
      // sign-in). 24h expiry matches the "pay within 24h" rule.
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: offer.listing.id,
          authorisedUserId: offer.buyerId,
          expiresAt: new Date(Date.now() + CHECKOUT_TTL_HOURS * 3600_000),
          metadata: { offerId: offer.id, agreedAmount: offer.offerAmount },
        })
        .catch((err) => {
          this.logger.warn(`CHECKOUT token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerAccepted({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        acceptedAmount: offer.offerAmount,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfAccept failed: ${(err as Error).message}`);
    }
  }

  // FLOW-F5 — buyer accepted the seller's counter. Agreed price = the
  // counter amount; mint a CHECKOUT token bound to the buyer + send the
  // "pay now" link (mirrors notifyBuyerOfAccept, which serves the
  // seller-accept path). Idempotency: acceptCounter has already flipped the
  // offer to ACCEPTED under a status guard, so a retried accept is a no-op
  // upstream and this only fires on the winning transition.
  private async notifyBuyerOfCounterAccept(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer || !offer.counterAmount) return;
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: offer.listing.id,
          authorisedUserId: offer.buyerId,
          expiresAt: new Date(Date.now() + CHECKOUT_TTL_HOURS * 3600_000),
          metadata: { offerId: offer.id, agreedAmount: offer.counterAmount },
        })
        .catch((err) => {
          this.logger.warn(`CHECKOUT token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerAccepted({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        acceptedAmount: offer.counterAmount,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfCounterAccept failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfReject(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer) return;
      await this.notifications.offerRejected({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
        reasonLabel: offer.rejectReason
          ? OFFER_REASON_LABEL[offer.rejectReason as OfferRejectReason]
          : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfReject failed: ${(err as Error).message}`);
    }
  }

  private async notifyBuyerOfCounter(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: true, buyer: true },
      });
      if (!offer || !offer.counterAmount) return;
      // Counter sent → mint a COUNTER_DECISION token for the buyer.
      // Expires with the counter (24h).
      const token = await this.actionTokens
        .mint({
          purpose: 'COUNTER_DECISION',
          targetType: 'offer',
          targetId: offer.id,
          authorisedUserId: offer.buyerId,
          expiresAt: offer.expiresAt ?? new Date(Date.now() + COUNTER_TTL_HOURS * 3600_000),
        })
        .catch((err) => {
          this.logger.warn(`COUNTER_DECISION token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.offerCountered({
        buyerEmail: offer.buyer.email,
        buyerName: offer.buyer.firstName ?? 'Buyer',
        buyerPhone: offer.buyer.phone,
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        originalAmount: offer.offerAmount,
        counterAmount: offer.counterAmount,
        sellerNote: offer.sellerNote ?? undefined,
        offerId: offer.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyBuyerOfCounter failed: ${(err as Error).message}`);
    }
  }

  private async notifySellerOfCounterAccepted(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer || !offer.counterAmount) return;
      await this.notifications.counterAccepted({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        // POPIA + platform policy: show the buyer's @username to the
        // seller, never their real legal name. The full name is only
        // revealed post-payment for shipping where legally required.
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        counterAmount: offer.counterAmount,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfCounterAccepted failed: ${(err as Error).message}`);
    }
  }

  private async notifySellerOfCounterRejected(offerId: string) {
    try {
      const offer = await this.prisma.offer.findUnique({
        where: { id: offerId },
        include: { listing: { include: { seller: true } }, buyer: true },
      });
      if (!offer) return;
      await this.notifications.counterRejected({
        sellerEmail: offer.listing.seller.email,
        sellerName: offer.listing.seller.firstName ?? 'Seller',
        // POPIA + platform policy: show the buyer's @username to the
        // seller, never their real legal name. The full name is only
        // revealed post-payment for shipping where legally required.
        buyerName: offer.buyer.username ?? 'A buyer',
        listingTitle: offer.listing.title,
        listingId: offer.listing.id,
        offerId: offer.id,
      });
    } catch (err) {
      this.logger.error(`notifySellerOfCounterRejected failed: ${(err as Error).message}`);
    }
  }
}
