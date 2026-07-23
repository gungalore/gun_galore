import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FeaturedAuctionKind,
  FeaturedAuctionStatus,
  FeaturedBidStatus,
  FeaturedSlotStatus,
  FeaturedTier,
  ListingStatus,
  Prisma,
  SubscriptionTier,
} from '@prisma/client';

/**
 * Phase E2 subscription perk (OD1 locked) — discount applied to the
 * winning bidder's featured-slot fee. The face bid (amountCents) is
 * unchanged so the auction ranking stays fair across tiers; the
 * actual cash collected is reduced.
 *
 *   FREE   → no discount
 *   MEMBER → 25% off
 *   PRO    → 50% off
 *
 * Snapshotted on the bid at place-bid time so the discount can't
 * be gamed by upgrading right before settlement (or unfairly
 * stripped if the bidder downgrades between bid + bind).
 */
export function featuredDiscountPercent(tier: SubscriptionTier): number {
  if (tier === SubscriptionTier.PRO) return 50;
  if (tier === SubscriptionTier.MEMBER) return 25;
  return 0;
}

/** Apply the snapshotted discount to a face bid. Always rounds DOWN
 *  in cents so we never accidentally charge more than the face. */
export function applyFeaturedDiscount(
  faceCents: number,
  discountPercent: number,
): number {
  const safe = Math.max(0, Math.min(99, Math.round(discountPercent)));
  return Math.floor((faceCents * (100 - safe)) / 100);
}
import { PrismaService } from '../prisma/prisma.service';
import { PeachService } from '../payments/peach.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { PAYMENT_MODE, assertPaymentsLive } from '../payments/payment-mode';

// P1.2 — how long the winner has to pay the slot fee by EFT once they
// pick a listing (manual rail). Mirrors the subscription pay window.
const FEATURED_PAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Review fix (re-arm squat): the ABSOLUTE cap on how long an UNPAID winner
// can hold a BIND_WINDOW slot, measured from the auction's closedAt (which
// never advances for the original winner). Past closedAt + bindWindow +
// this, the slot is forfeited even if the winner keeps re-arming their
// per-bind paymentPayByAt. One extra pay-window of slack beyond the first.
export const FEATURED_UNPAID_MAX_MS = FEATURED_PAY_WINDOW_MS;

// Buy-Now premium: the fixed multiple of a tier's base price a seller
// pays to skip the auction and take the slot outright + immediately.
// 2× = "pay double the tier price, no bidding, live now" (operator call
// 2026-07-20). The subscription discount still applies to this doubled
// base, so a PRO seller nets the tier's normal price for the convenience.
export const BUY_NOW_MULTIPLIER = 2;

// Featured-slot service.
//
// 10 slots rotate via per-slot auctions:
//   - SCHEDULED auctions open 24h before the predecessor's
//     featuredUntil. Close exactly at featuredUntil. Winner takes over
//     seamlessly with zero gap.
//   - AD_HOC auctions open immediately when a slot frees unexpectedly
//     (occupant's listing sold mid-feature OR admin force-evicted).
//     Run for 2h to fill the slot fast.
//
// Bid → win → 15-min bind window to pick a listing → Peach charged →
// listing goes featured for the tier duration. If the winner doesn't
// bind in time the system cascades to the runner-up.
//
// All durations + tier prices are read live from FeaturedSlotConfig
// so the operator can re-tune without a deploy.

@Injectable()
export class FeaturedService {
  private readonly logger = new Logger(FeaturedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly peach: PeachService,
    // NOT @Global — FeaturedModule imports ZohoBooksModule explicitly
    // (the SwapsModule boot-crash lesson). Posts the slot-fee Sales
    // Receipt; feature-flagged no-op until ZOHO_BOOKS_ENABLED=true.
    private readonly zohoBooks: ZohoBooksService,
    // Both @Global (NotificationsModule / ReferenceNumberModule).
    // `notifications` fires the slot-fee-received message from the
    // confirmSlotPayment reconciler. `referenceNumbers` allocated the FS
    // pay-in reference for the now-retired manual-EFT slot-fee lane; the
    // binding no longer issues one (kept injected as a rail-agnostic seam
    // for when the card paygate wires real slot-fee capture in).
    private readonly notifications: NotificationsService,
    private readonly referenceNumbers: ReferenceNumberService,
  ) {}

  // ─── Config helpers ─────────────────────────────────────────────────

  async getConfig() {
    const cfg = await this.prisma.featuredSlotConfig.findUnique({
      where: { id: 'default' },
    });
    if (!cfg) {
      // Seed defensively — first-ever boot might race the prisma seed
      // script. Defaults match the agreed table.
      return this.prisma.featuredSlotConfig.create({
        data: { id: 'default' },
      });
    }
    return cfg;
  }

  // Resolve a raw bid amount to its tier. Snaps DOWN — bidding R300
  // gets you the R250 tier (T2_3D), not the R500 tier. The frontend
  // shows the snapped tier + duration BEFORE the bid lands so a
  // bidder is never surprised.
  async snapToTier(
    amountCents: number,
  ): Promise<{ tier: FeaturedTier; tierAmountCents: number; durationSec: number }> {
    const cfg = await this.getConfig();
    const bands: { tier: FeaturedTier; cents: number; sec: number }[] = [
      { tier: 'T5', cents: cfg.t5AmountCents, sec: cfg.t5DurationSec },
      { tier: 'T4', cents: cfg.t4AmountCents, sec: cfg.t4DurationSec },
      { tier: 'T3', cents: cfg.t3AmountCents, sec: cfg.t3DurationSec },
      { tier: 'T2', cents: cfg.t2AmountCents, sec: cfg.t2DurationSec },
      { tier: 'T1', cents: cfg.t1AmountCents, sec: cfg.t1DurationSec },
    ];
    for (const b of bands) {
      if (amountCents >= b.cents) {
        return { tier: b.tier, tierAmountCents: b.cents, durationSec: b.sec };
      }
    }
    throw new BadRequestException(
      `Bid below floor: minimum is R${(cfg.bidFloorCents / 100).toFixed(0)}`,
    );
  }

  // ─── Public reads ───────────────────────────────────────────────────

  // Featured grid for the homepage. ALWAYS returns 10 entries — one
  // per slot, ordered by slotNumber — so the grid layout is stable
  // regardless of how many slots are currently filled. Empty entries
  // (`listing: null`) become "bid for this spot" placeholder cards
  // on the frontend.
  //
  // The listing payload (when present) matches the marketplace browse
  // response shape so the homepage can render with the same
  // <ListingCard> component.
  async getFeaturedListings() {
    const slots = await this.prisma.featuredSlot.findMany({
      orderBy: { slotNumber: 'asc' },
      select: { slotNumber: true, status: true, currentListingId: true },
    });
    const ids = slots
      .map((s) => s.currentListingId)
      .filter((x): x is string => !!x);
    const listings = ids.length
      ? await this.prisma.listing.findMany({
          // Only surface a slot's listing while it is still up for grabs.
          // Drops out instantly when it sells (ACTIVE -> PAYMENT_PENDING/SOLD),
          // is cancelled/expires, OR the seller accepts an offer (item is
          // promised to a buyer) — so a sold/committed item never lingers in
          // the featured strip during the up-to-1-min window before the cron
          // recycles the slot. (Slot cleanup + re-auction still happens in the
          // featured cron; this is the instant buyer-facing display guard.)
          where: {
            id: { in: ids },
            status: ListingStatus.ACTIVE,
            offers: { none: { status: 'ACCEPTED' } },
          },
          include: {
            images: { where: { isPrimary: true }, take: 1 },
            category: { select: { id: true, name: true, slug: true } },
            // Public featured-slot surface — username only, no real
            // name (platform policy).
            seller: {
              select: {
                id: true,
                username: true,
                sellerTier: true,
              },
            },
          },
        })
      : [];
    const byId = new Map(listings.map((l) => [l.id, l]));
    return slots.map((s) => ({
      slotNumber: s.slotNumber,
      status: s.status,
      listing: s.currentListingId ? byId.get(s.currentListingId) ?? null : null,
    }));
  }

  // Public availability summary for the homepage "Featured spots" bar —
  // how many slots are open to bid on, how many are already taking bids,
  // and the biddable slots themselves (so a seller can click straight into
  // a specific open slot). Bid AMOUNTS + COUNTS are public (auction prices,
  // like any bidding site); bidder identity is deliberately NOT exposed
  // here — that stays on the authed getSlotsForBidder path.
  async getFeaturedSummary() {
    const slots = await this.prisma.featuredSlot.findMany({
      orderBy: { slotNumber: 'asc' },
      select: {
        id: true,
        slotNumber: true,
        status: true,
        currentAuctionId: true,
        currentAuction: { select: { status: true, closesAt: true } },
      },
    });
    const enriched = await Promise.all(
      slots.map(async (s) => {
        const auctionOpen = s.currentAuction?.status === 'OPEN';
        let topBidCents: number | null = null;
        let bidCount = 0;
        if (s.currentAuctionId && auctionOpen) {
          const [top, count] = await Promise.all([
            this.prisma.featuredSlotBid.findFirst({
              where: { auctionId: s.currentAuctionId, status: 'ACTIVE' },
              orderBy: { amountCents: 'desc' },
              select: { amountCents: true },
            }),
            this.prisma.featuredSlotBid.count({
              where: { auctionId: s.currentAuctionId, status: 'ACTIVE' },
            }),
          ]);
          topBidCents = top?.amountCents ?? null;
          bidCount = count;
        }
        return {
          id: s.id,
          slotNumber: s.slotNumber,
          status: s.status,
          auctionOpen,
          closesAt: s.currentAuction?.closesAt ?? null,
          topBidCents,
          bidCount,
        };
      }),
    );
    // "Available" = biddable = not held by a winner (BIND_WINDOW) and not
    // live (OCCUPIED). AUCTION_RUNNING is actively taking bids; VACANT is
    // a slot whose fresh auction opens on the next cron tick.
    const openSlots = enriched.filter(
      (s) => s.status === 'AUCTION_RUNNING' || s.status === 'VACANT',
    );
    const highest = enriched.reduce(
      (m, s) => Math.max(m, s.topBidCents ?? 0),
      0,
    );
    return {
      totalSlots: slots.length,
      openCount: openSlots.length,
      takingBidsCount: enriched.filter((s) => s.bidCount > 0).length,
      occupiedCount: enriched.filter((s) => s.status === 'OCCUPIED').length,
      topBidCents: highest > 0 ? highest : null,
      openSlots,
    };
  }

  // The 10 slots — what's currently featured (for the rail) + which
  // slot has an OPEN auction (for the bid page). Sorted by slotNumber
  // so the rail order is stable.
  async getRail() {
    const slots = await this.prisma.featuredSlot.findMany({
      orderBy: { slotNumber: 'asc' },
      include: {
        currentListing: {
          select: {
            id: true,
            title: true,
            price: true,
            // status + any accepted offer drive the display guard below — a
            // sold/inactive/committed occupant is nulled out so the rail
            // shows the slot as an open "bid for a spot" placeholder instead
            // of a dead card.
            status: true,
            offers: {
              where: { status: 'ACCEPTED' },
              take: 1,
              select: { id: true },
            },
            listingType: true,
            currentBid: true,
            buyNowPrice: true,
            seller: { select: { username: true } },
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
            category: { select: { name: true } },
          },
        },
        currentAuction: {
          select: {
            id: true,
            kind: true,
            status: true,
            openedAt: true,
            closesAt: true,
          },
        },
      },
    });
    // Instant buyer-facing guard: the moment a featured listing leaves ACTIVE
    // (sells, cancelled, expires) OR gets an accepted offer (promised to a
    // buyer), it stops rendering in the rail/sticky strip — without waiting
    // for the once-a-minute cron to free the slot. Strip the internal
    // status/offers fields back out so the response shape is unchanged.
    return slots.map((s) => {
      const cl = s.currentListing;
      if (!cl) return s;
      const unavailable =
        cl.status !== ListingStatus.ACTIVE || cl.offers.length > 0;
      if (unavailable) return { ...s, currentListing: null };
      const { status: _status, offers: _offers, ...listing } = cl;
      return { ...s, currentListing: listing };
    });
  }

  // ─── Per-user bid history for /my/bids ─────────────────────────────
  // Returns every featured-slot bid the user has placed (across all
  // slots + auction generations), enriched with the slot number, the
  // current top bid in that auction, whether the bid is the high
  // bidder right now, and whether it ultimately won. Drives the
  // "Featured slot bids" section on the /my/bids dashboard so a seller
  // can see all their featured bidding alongside their auction bids.
  async getMyFeaturedBids(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) return [];

    const bids = await this.prisma.featuredSlotBid.findMany({
      where: { bidderId: user.id },
      include: {
        auction: {
          select: {
            id: true,
            status: true,
            closesAt: true,
            closedAt: true,
            winningBidId: true,
            slot: { select: { id: true, slotNumber: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Look up the current top ACTIVE bid per unique auction so the
    // frontend can render "High bidder" vs "Outbid" badges without
    // doing the comparison itself. One query per auction; the user is
    // very unlikely to have bid on more than a handful of auctions.
    const auctionIds = Array.from(new Set(bids.map((b) => b.auctionId)));
    const tops = new Map<string, { id: string; amountCents: number } | null>();
    await Promise.all(
      auctionIds.map(async (aid) => {
        const top = await this.prisma.featuredSlotBid.findFirst({
          where: { auctionId: aid, status: 'ACTIVE' },
          orderBy: { amountCents: 'desc' },
          select: { id: true, amountCents: true },
        });
        tops.set(aid, top);
      }),
    );

    return bids.map((b) => {
      const top = tops.get(b.auctionId) ?? null;
      return {
        bidId: b.id,
        slotId: b.auction.slot.id,
        slotNumber: b.auction.slot.slotNumber,
        slotStatus: b.auction.slot.status,
        amountCents: b.amountCents,
        tier: b.tier,
        bidStatus: b.status,
        auctionStatus: b.auction.status,
        closesAt: b.auction.closesAt,
        closedAt: b.auction.closedAt,
        isWinner: b.auction.winningBidId === b.id,
        youAreHighBidder: top?.id === b.id,
        currentTopBid: top?.amountCents ?? null,
        createdAt: b.createdAt,
      };
    });
  }

  // Slots overview for the seller bid page. Adds: top bid per OPEN
  // auction, bidder count, and the seller's own current bid (if any).
  async getSlotsForBidder(clerkId: string | null) {
    const slots = await this.getRail();
    let bidderId: string | null = null;
    // Phase E2 — surface the bidder's discount up-front so the bid
    // page can preview "you'll pay R250 (R500 × 50% PRO discount)"
    // before they commit.
    let bidderSubscriptionTier: SubscriptionTier = SubscriptionTier.FREE;
    let bidderDiscountPercent = 0;
    if (clerkId) {
      const buyer = await this.prisma.user.findUnique({
        where: { clerkId },
        select: { id: true, subscriptionTier: true },
      });
      bidderId = buyer?.id ?? null;
      if (buyer) {
        bidderSubscriptionTier = buyer.subscriptionTier;
        bidderDiscountPercent = featuredDiscountPercent(buyer.subscriptionTier);
      }
    }
    const enriched = await Promise.all(
      slots.map(async (s) => {
        if (!s.currentAuctionId) return { ...s, topBid: null, yourBid: null, bidCount: 0 };
        const [top, mine, count] = await Promise.all([
          this.prisma.featuredSlotBid.findFirst({
            where: { auctionId: s.currentAuctionId, status: 'ACTIVE' },
            orderBy: { amountCents: 'desc' },
            select: {
              id: true,
              amountCents: true,
              tier: true,
              bidder: { select: { username: true } },
            },
          }),
          bidderId
            ? this.prisma.featuredSlotBid.findFirst({
                where: {
                  auctionId: s.currentAuctionId,
                  bidderId,
                  status: 'ACTIVE',
                },
                select: {
                  id: true,
                  amountCents: true,
                  tier: true,
                  discountPercent: true,
                  chargedAmountCents: true,
                },
              })
            : Promise.resolve(null),
          this.prisma.featuredSlotBid.count({
            where: { auctionId: s.currentAuctionId, status: 'ACTIVE' },
          }),
        ]);
        return { ...s, topBid: top, yourBid: mine, bidCount: count };
      }),
    );
    return {
      slots: enriched,
      bidderSubscriptionTier,
      bidderDiscountPercent,
    };
  }

  // ─── Seller flow: bid → win → bind listing ──────────────────────────

  async placeBid(clerkId: string, slotId: string, amountCents: number) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    if (user.isBanned) throw new ForbiddenException('Account suspended');

    // Featured-slot specific ban check — separate from listing-side ban.
    const ban = await this.prisma.featuredSlotBidderBan.findUnique({
      where: { userId: user.id },
    });
    if (ban) {
      throw new ForbiddenException(
        `Banned from featured-slot bidding: ${ban.reason}`,
      );
    }

    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
      include: { currentAuction: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.currentAuctionId || !slot.currentAuction) {
      throw new BadRequestException(
        'No auction is currently open on this slot',
      );
    }
    if (slot.currentAuction.status !== 'OPEN') {
      throw new BadRequestException('Auction is no longer open');
    }
    // Only reject by time if the auction's timer has actually been
    // started — closesAt is null while we're still waiting for the
    // first bid, in which case ANY bid is valid (and will trigger
    // the timer below).
    if (
      slot.currentAuction.closesAt &&
      new Date() >= slot.currentAuction.closesAt
    ) {
      throw new BadRequestException('Auction has just closed');
    }
    // Seller can't bid on their own slot (if they happen to be the
    // current occupant). Operator allows holding multiple slots, but
    // not the same slot twice in a row directly.
    if (slot.currentSellerId === user.id) {
      throw new ForbiddenException(
        'Cannot bid on a slot you currently occupy',
      );
    }

    // Snap to tier + validate floor.
    const cfg = await this.getConfig();
    if (amountCents < cfg.bidFloorCents) {
      throw new BadRequestException(
        `Bid below floor: minimum is R${(cfg.bidFloorCents / 100).toFixed(0)}`,
      );
    }
    const snapped = await this.snapToTier(amountCents);

    // Multiple bids per auction allowed (raise your max like normal
    // auctions). Validate against the bidder's own most-recent bid in
    // this auction — must outbid themselves.
    const myLatest = await this.prisma.featuredSlotBid.findFirst({
      where: {
        auctionId: slot.currentAuctionId,
        bidderId: user.id,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (myLatest && amountCents <= myLatest.amountCents) {
      throw new BadRequestException(
        `You must outbid your own previous bid of R${(myLatest.amountCents / 100).toFixed(0)}`,
      );
    }

    // Phase E2 — snapshot the bidder's subscription perk on the bid.
    // Locking it at bid-time means a tier change between now + bind
    // can't move the goalposts in either direction.
    const discountPercent = featuredDiscountPercent(user.subscriptionTier);

    const bid = await this.prisma.featuredSlotBid.create({
      data: {
        auctionId: slot.currentAuctionId,
        bidderId: user.id,
        amountCents: snapped.tierAmountCents,
        tier: snapped.tier,
        discountPercent,
        status: 'ACTIVE',
      },
    });

    // First bid on this auction starts the 24h close timer. Subsequent
    // bids during the window do NOT reset closesAt — the highest bid
    // at the moment the timer hits zero wins.
    let timerStarted = false;
    if (slot.currentAuction.closesAt === null) {
      const closesAt = new Date(Date.now() + cfg.bidWindowSec * 1000);
      await this.prisma.featuredAuction.update({
        where: { id: slot.currentAuctionId },
        data: { closesAt },
      });
      timerStarted = true;
      await this.recordEvent(slot.id, 'AUCTION_TIMER_STARTED', {
        auctionId: slot.currentAuctionId,
        closesAt: closesAt.toISOString(),
        triggerBidId: bid.id,
      }, user.id);
    }

    await this.recordEvent(slot.id, 'BID_PLACED', {
      bidId: bid.id,
      amountCents: snapped.tierAmountCents,
      tier: snapped.tier,
      discountPercent,
      timerStarted,
    }, user.id);

    return {
      bid,
      snappedTier: snapped.tier,
      snappedAmountCents: snapped.tierAmountCents,
      durationSec: snapped.durationSec,
      // Phase E2 — surface what was applied so the receipt UI can
      // show "GG+ saved you R250" without re-fetching the bid.
      discountPercent,
      effectiveChargeCents: applyFeaturedDiscount(
        snapped.tierAmountCents,
        discountPercent,
      ),
      timerStarted,
    };
  }

  // ─── Buy Now: claim a slot OUTRIGHT, skipping the auction ───────────
  //
  // A seller pays a fixed premium — BUY_NOW_MULTIPLIER × the chosen
  // tier's base price — to take a featured slot immediately instead of
  // bidding + waiting out the 24h auction. They pick the tier (which
  // sets the featured DURATION) + the listing up front, so the whole
  // thing is atomic: no 15-min bind window. The subscription discount
  // (PRO −50%) applies to the doubled base, exactly like an auction bid,
  // so the charged cash uses the same applyFeaturedDiscount snapshot.
  //
  // Only valid on a slot that is AUCTION_RUNNING or VACANT — never one
  // with a live paying occupant (OCCUPIED) or a winner mid-bind
  // (BIND_WINDOW). Any open auction on the slot is closed AWARDED to the
  // buy-now purchase and its outstanding bids marked LOST (a Buy It Now
  // out-bids everyone; no money was collected from them so nothing to
  // refund).
  //
  // Payment routes through the SAME seam as bindListingToSlot: on the
  // manual rail (current prod state) assertPaymentsLive() throws 503
  // "launching soon" BEFORE any write, so Buy Now is inert until the
  // card paygate is live. Non-prod paygate uses the synthetic-id path so
  // the flow stays exercisable end-to-end.
  async buyNow(
    clerkId: string,
    slotId: string,
    tier: FeaturedTier,
    listingId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    if (user.isBanned) throw new ForbiddenException('Account suspended');

    const ban = await this.prisma.featuredSlotBidderBan.findUnique({
      where: { userId: user.id },
    });
    if (ban) {
      throw new ForbiddenException(
        `Banned from featured slots: ${ban.reason}`,
      );
    }

    // ── Payment gate (mirrors bindListingToSlot) ──────────────────────
    // Do this BEFORE opening the transaction so production (manual rail,
    // payments not live) touches no rows at all — the seller lands on the
    // shared "card payments launching soon" 503 surface.
    if (PAYMENT_MODE === 'manual') {
      // Throws ServiceUnavailable (503) while PAYMENTS_LIVE is false — the
      // current state. The manual-EFT slot-fee lane is retired, so there
      // is no rail to collect a Buy Now fee yet.
      assertPaymentsLive();
      // Defensive: if payments are ever flipped live while STILL on the
      // manual rail, refuse rather than hand out free featuring — real
      // fee capture is owned by the card paygate rail.
      throw new BadRequestException(
        'Featured Buy Now is not available yet — card checkout is launching soon.',
      );
    }
    if (PAYMENT_MODE === 'paygate' && process.env.NODE_ENV === 'production') {
      // AUDIT H1 (same as bind): no real gateway charge is wired here yet,
      // so refuse in production to avoid handing out free homepage
      // featuring on a fabricated payment id. Non-prod keeps the synthetic
      // path below so the paygate lifecycle stays testable.
      throw new BadRequestException(
        'Featured Buy Now is temporarily disabled while the new payment integration is being wired. Please try again later.',
      );
    }

    const cfg = await this.getConfig();
    const baseCents = tierAmount(tier, cfg) * BUY_NOW_MULTIPLIER;
    const durationSec = tierDuration(tier, cfg);
    // Snapshot the subscription discount on the purchase, same as a bid.
    const discountPercent = featuredDiscountPercent(user.subscriptionTier);
    const chargedAmountCents = applyFeaturedDiscount(baseCents, discountPercent);

    const result = await this.prisma.$transaction(async (tx) => {
      const slot = await tx.featuredSlot.findUnique({
        where: { id: slotId },
        include: { currentAuction: true },
      });
      if (!slot) throw new NotFoundException('Slot not found');
      // Fast-fail on the common case; the FINAL CAS below is the real
      // race guard (a concurrent buy-now / auction-close between this read
      // and the claim is caught there).
      if (slot.status !== 'AUCTION_RUNNING' && slot.status !== 'VACANT') {
        throw new BadRequestException(
          'This slot is not available for Buy Now right now — it is either live or being claimed by an auction winner.',
        );
      }

      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          sellerId: true,
          status: true,
          isDealListing: true,
          featuredInSlot: { select: { id: true } },
          // A live accepted offer means the item is already promised to a
          // buyer — block featuring it (the recycler would reclaim the slot
          // on the next tick, so the seller would pay for nothing).
          offers: {
            where: { status: 'ACCEPTED' },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.sellerId !== user.id) {
        throw new ForbiddenException('Listing is not yours');
      }
      if (listing.isDealListing) {
        throw new BadRequestException('Daily Deals cannot be featured');
      }
      if (listing.status !== 'ACTIVE') {
        throw new BadRequestException('Listing must be ACTIVE to be featured');
      }
      if (listing.offers.length > 0) {
        throw new BadRequestException(
          'Listing has an accepted offer — it is already promised to a buyer and cannot be featured',
        );
      }
      if (listing.featuredInSlot) {
        throw new BadRequestException(
          'Listing is already featured in another slot',
        );
      }

      // Auction: reuse the slot's open auction (award it to this purchase
      // + mark its outstanding bids LOST) or spin up a fresh closed one so
      // the buy-now bid always hangs off an auction row (revenue + audit).
      const now = new Date();
      let auctionId = slot.currentAuctionId;
      if (auctionId) {
        await tx.featuredSlotBid.updateMany({
          where: { auctionId, status: 'ACTIVE' },
          data: { status: 'LOST' },
        });
      } else {
        const created = await tx.featuredAuction.create({
          data: {
            slotId: slot.id,
            kind: FeaturedAuctionKind.AD_HOC,
            status: FeaturedAuctionStatus.CLOSED_AWARDED,
            closesAt: now,
            closedAt: now,
          },
        });
        auctionId = created.id;
      }

      const bid = await tx.featuredSlotBid.create({
        data: {
          auctionId,
          bidderId: user.id,
          amountCents: baseCents,
          tier,
          isBuyNow: true,
          discountPercent,
          chargedAmountCents,
          status: 'WON',
          paidAt: now,
        },
      });
      // Bid-scoped synthetic paygate id (real capture wired at paygate
      // cutover) — mirrors the auction bind path's `featured-<bidId>` so
      // it's per-purchase unique + traceable, not slot-scoped (which would
      // collide across successive buy-nows on one slot).
      await tx.featuredSlotBid.update({
        where: { id: bid.id },
        data: { peachPaymentId: `featured-buynow-${bid.id}` },
      });

      await tx.featuredAuction.update({
        where: { id: auctionId },
        data: {
          status: FeaturedAuctionStatus.CLOSED_AWARDED,
          closedAt: now,
          winningBidId: bid.id,
        },
      });

      const featuredUntil = new Date(now.getTime() + durationSec * 1000);

      // FINAL CAS — the atomic race guard. Guarded on the ORIGINAL
      // eligible statuses so a concurrent buy-now / auction-close that
      // already moved this slot on wins and this whole transaction
      // (including the auction + bid rows created above) rolls back.
      const claim = await tx.featuredSlot.updateMany({
        where: { id: slot.id, status: { in: ['AUCTION_RUNNING', 'VACANT'] } },
        data: {
          status: FeaturedSlotStatus.OCCUPIED,
          currentListingId: listing.id,
          currentSellerId: user.id,
          currentAuctionId: auctionId,
          featuredUntil,
        },
      });
      if (claim.count === 0) {
        throw new BadRequestException(
          'This slot was just claimed by someone else — please pick another.',
        );
      }

      await this.recordEvent(
        slot.id,
        'BUY_NOW_PURCHASED',
        {
          bidId: bid.id,
          tier,
          baseCents,
          chargedAmountCents,
          discountPercent,
          listingId: listing.id,
        },
        user.id,
        undefined,
        tx,
      );
      await this.recordEvent(
        slot.id,
        'LISTING_BOUND',
        {
          listingId: listing.id,
          featuredUntil: featuredUntil.toISOString(),
          durationSec,
          viaBuyNow: true,
        },
        user.id,
        undefined,
        tx,
      );
      await this.recordEvent(
        slot.id,
        'FEATURED_LIVE',
        {
          listingId: listing.id,
          featuredUntil: featuredUntil.toISOString(),
        },
        undefined,
        undefined,
        tx,
      );

      return {
        bidId: bid.id,
        featuredUntil,
        tier,
        durationSec,
        baseCents,
        chargedAmountCents,
        discountPercent,
      };
    }).catch((err) => {
      // Two concurrent buy-nows of the SAME listing on two eligible slots
      // both pass the non-atomic featuredInSlot read, then the loser's
      // FINAL CAS trips the @unique on FeaturedSlot.currentListingId. Turn
      // that raw P2002 into the same graceful message the read produces
      // instead of surfacing a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Listing is already featured in another slot',
        );
      }
      throw err;
    });

    // Zoho Books slot-fee Sales Receipt — fire-and-forget AFTER commit, so
    // createFeaturedSlotInvoice's base-client read sees the committed bid
    // row (firing inside the tx read it as null and silently dropped it).
    // Only the paygate rail reaches here (manual threw above), and it
    // captured the money synthetically, so this path owns the receipt.
    void this.zohoBooks.createFeaturedSlotInvoice(result.bidId);

    return {
      featuredUntil: result.featuredUntil,
      tier: result.tier,
      durationSec: result.durationSec,
      baseCents: result.baseCents,
      chargedAmountCents: result.chargedAmountCents,
      discountPercent: result.discountPercent,
    };
  }

  // Winner binds a listing to the slot. Must be called within the
  // bind window. Charges Peach AFTER the listing is validated +
  // bound, so a payment never lands on a slot we couldn't fill.
  async bindListingToSlot(clerkId: string, slotId: string, listingId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');

    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.featuredSlot.findUnique({
        where: { id: slotId },
        include: {
          currentAuction: { include: { winningBid: true } },
        },
      });
      if (!slot) throw new NotFoundException('Slot not found');
      if (slot.status !== 'BIND_WINDOW') {
        throw new BadRequestException(
          `Slot is not in a bind window (status: ${slot.status})`,
        );
      }
      const winningBid = slot.currentAuction?.winningBid;
      if (!winningBid) throw new BadRequestException('No winning bid recorded');
      if (winningBid.bidderId !== user.id) {
        throw new ForbiddenException('This slot is not yours to bind');
      }

      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          sellerId: true,
          status: true,
          isDealListing: true,
          featuredInSlot: { select: { id: true } },
          // A live accepted offer means the item is already promised to a
          // buyer — block featuring it (the recycler would reclaim the slot
          // on the next tick, so the seller would pay for nothing).
          offers: {
            where: { status: 'ACCEPTED' },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.sellerId !== user.id) {
        throw new ForbiddenException('Listing is not yours');
      }
      // First-party Daily Deals live only on /deals — never on the homepage
      // featured rail (defense-in-depth; the house seller never bids).
      if (listing.isDealListing) {
        throw new BadRequestException('Daily Deals cannot be featured');
      }
      if (listing.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Listing must be ACTIVE to be featured',
        );
      }
      if (listing.offers.length > 0) {
        throw new BadRequestException(
          'Listing has an accepted offer — it is already promised to a buyer and cannot be featured',
        );
      }
      // listingType is intentionally NOT checked — Marketplace
      // (BUY_NOW), Auction (AUCTION), and Take a Shot (TAKE_A_SHOT)
      // listings are all valid bind targets. The rail surfaces the
      // listing type to buyers via the card design, so the choice is
      // purely the seller's. Do not narrow this without a product call.
      if (listing.featuredInSlot) {
        throw new BadRequestException(
          'Listing is already featured in another slot',
        );
      }

      // P1.2 — slot-fee collection depends on the payment rail.
      if (PAYMENT_MODE === 'manual') {
        if (!winningBid.paidAt) {
          // Manual-EFT slot-fee pay-in has been RETIRED. There is no rail to
          // collect the slot fee until the card paygate is live, so an unpaid
          // winner binding a listing lands on the shared "card payments are
          // launching soon" gate — exactly how every checkout entry point
          // gates itself (assertPaymentsLive). No orderReference / pay-by
          // deadline / bank-deposit instructions are issued, and the
          // historical AWAITING_EFT_PAYMENT audit event is no longer written.
          //
          // Nothing is persisted here: assertPaymentsLive() throws before any
          // write, so the interactive transaction rolls back cleanly — the
          // winning bid stays as-is and the slot stays in BIND_WINDOW for the
          // cron to cascade/reopen. The booking + money-state logic further
          // down is unchanged and rail-agnostic; only the manual-EFT
          // instructions behaviour has been removed here.
          assertPaymentsLive();
          // Defensive: assertPaymentsLive() throws while PAYMENTS_LIVE is
          // false (the current state), so nothing below runs. If payments are
          // ever flipped live while STILL on the manual rail, refuse the bind
          // rather than hand out free featuring — real slot-fee capture is
          // owned by the card paygate rail (PAYMENT_MODE=paygate) below.
          throw new BadRequestException(
            'Featured-slot payment collection is not available yet — card checkout is launching soon.',
          );
        }
        // Already paid (reconciler confirmed the EFT) — complete the
        // bind WITHOUT touching payment fields. Covers the auto-bind
        // from confirmSlotPayment and the re-pick path when the
        // original pending listing stopped being bindable while the
        // money was in flight.
        if (winningBid.pendingListingId !== listing.id) {
          await tx.featuredSlotBid.update({
            where: { id: winningBid.id },
            data: { pendingListingId: listing.id },
          });
        }
      } else {
        // Paygate rail — AUDIT H1: until a real gateway charge is wired
        // here, the binding marks the bid PAID with a fabricated id
        // ("featured-<bidId>") which (a) gives away featuring for free,
        // (b) inflates the admin revenue dashboard with phantom income,
        // and (c) makes the force-evict path try to refund a gateway
        // payment that was never captured. Refuse binding in production
        // so we can't accidentally hand out free homepage featuring; in
        // non-prod keep the synthetic-id path so the paygate lifecycle
        // stays exercisable end-to-end. Tracked on LAUNCH-CHECKLIST.md.
        if (process.env.NODE_ENV === 'production') {
          throw new BadRequestException(
            'Featured-slot binding is temporarily disabled while the new payment integration is being wired. Please try again later or contact support.',
          );
        }
        const peachPaymentId = `featured-${winningBid.id}`;
        // Phase E2 — collect the discounted amount (snapshot on the
        // bid). Defaults to face amount when discountPercent=0.
        const chargedAmountCents = applyFeaturedDiscount(
          winningBid.amountCents,
          winningBid.discountPercent ?? 0,
        );
        await tx.featuredSlotBid.update({
          where: { id: winningBid.id },
          data: {
            status: 'WON',
            paidAt: new Date(),
            peachPaymentId,
            chargedAmountCents,
          },
        });
      }

      // Compute featuredUntil from the tier.
      const cfg = await this.getConfig();
      const durationSec = tierDuration(winningBid.tier, cfg);
      const featuredUntil = new Date(Date.now() + durationSec * 1000);

      await tx.featuredSlot.update({
        where: { id: slot.id },
        data: {
          status: 'OCCUPIED',
          currentListingId: listing.id,
          currentSellerId: user.id,
          featuredUntil,
        },
      });

      await this.recordEvent(slot.id, 'LISTING_BOUND', {
        listingId: listing.id,
        featuredUntil: featuredUntil.toISOString(),
        durationSec,
      }, user.id, undefined, tx);
      await this.recordEvent(slot.id, 'FEATURED_LIVE', {
        listingId: listing.id,
        featuredUntil: featuredUntil.toISOString(),
      }, undefined, undefined, tx);

      // Zoho Books: post a Sales Receipt for the slot fee. Fire-and-
      // forget outside the DB transaction — Books failures don't block
      // the binding.
      //
      // Review fix (duplicate receipt): on the MANUAL rail the money
      // landed at confirmSlotPayment, which already fires this call —
      // so firing it AGAIN here (the auto-bind runs inside
      // confirmSlotPayment) double-posts past the non-atomic
      // zohoInvoiceId guard. Only the PAYGATE rail captures money inside
      // bind, so only the paygate path owns the receipt here.
      if (PAYMENT_MODE !== 'manual') {
        void this.zohoBooks.createFeaturedSlotInvoice(winningBid.id);
      }

      return { featuredUntil };
    });
  }

  // P1.2 — reconciler hook: the FS-referenced EFT landed (inContact
  // detection or authoritative statement row). Exactly-once atomic
  // claim on paidAt, then auto-bind the listing the winner picked at
  // instruction time. Idempotent: a second call (statement after
  // inContact) finds paidAt set and no-ops.
  async confirmSlotPayment(bidId: string) {
    const claimed = await this.prisma.featuredSlotBid.updateMany({
      where: { id: bidId, status: 'WON', paidAt: null },
      data: { paidAt: new Date() },
    });
    if (claimed.count === 0) {
      this.logger.log(
        `confirmSlotPayment: bid ${bidId} already paid or not payable — no-op`,
      );
      return { bound: false, alreadyPaid: true };
    }

    const bid = await this.prisma.featuredSlotBid.findUnique({
      where: { id: bidId },
      include: {
        bidder: {
          select: {
            clerkId: true,
            email: true,
            firstName: true,
            phone: true,
          },
        },
        auction: { select: { slotId: true } },
      },
    });
    if (!bid) return { bound: false, alreadyPaid: false };

    // Books: Sales Receipt for the cash that just landed. Idempotent
    // via bid.zohoInvoiceId, so the bind-completion call below (or a
    // reconciler retry) can't double-post.
    void this.zohoBooks.createFeaturedSlotInvoice(bidId);

    try {
      if (!bid.pendingListingId) {
        throw new Error('no pending listing recorded on the bid');
      }
      const res = await this.bindListingToSlot(
        bid.bidder.clerkId,
        bid.auction.slotId,
        bid.pendingListingId,
      );
      void this.notifications
        .featuredSlotPaymentReceived({
          email: bid.bidder.email,
          name: bid.bidder.firstName ?? 'there',
          phone: bid.bidder.phone,
          amountCents: bid.chargedAmountCents ?? bid.amountCents,
          bound: true,
          featuredUntil:
            'featuredUntil' in res ? (res.featuredUntil as Date) : null,
        })
        .catch(() => undefined);
      return { bound: true };
    } catch (err) {
      // The pending listing stopped being bindable while the money was
      // in flight (sold / deactivated / featured elsewhere) or the slot
      // state changed. Money stays received (paidAt set) — the winner
      // re-picks via the normal bind endpoint, which binds paid bids
      // without a second charge.
      this.logger.warn(
        `confirmSlotPayment: paid bid ${bidId} could not auto-bind: ${(err as Error).message}`,
      );
      void this.notifications
        .featuredSlotPaymentReceived({
          email: bid.bidder.email,
          name: bid.bidder.firstName ?? 'there',
          phone: bid.bidder.phone,
          amountCents: bid.chargedAmountCents ?? bid.amountCents,
          bound: false,
          featuredUntil: null,
        })
        .catch(() => undefined);
      return { bound: false };
    }
  }

  // ─── Lifecycle helpers (called by cron / hooks) ─────────────────────

  // Opens an auction on a vacant slot. The auction stays OPEN with
  // closesAt = null until a seller places a bid — at which point
  // placeBid() sets closesAt = now + bidWindowSec (24h). Called by
  // the cron whenever a slot is VACANT + has no current auction
  // (covers: cold start, post-sale vacancy, post-evict vacancy,
  // post-NO_BIDS recycle).
  //
  // Note: AD_HOC kind is kept as the only value used — the previous
  // SCHEDULED kind is gone because we no longer pre-open auctions
  // 24h before the predecessor expires. The slot frees → auction
  // opens → waits for first bid. Operator decision.
  async openAuction(slotId: string) {
    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) return;
    if (slot.currentAuctionId) return;

    const auction = await this.prisma.featuredAuction.create({
      data: {
        slotId,
        kind: FeaturedAuctionKind.AD_HOC,
        status: FeaturedAuctionStatus.OPEN,
        // closesAt null — timer starts on first bid.
        closesAt: null,
      },
    });
    // CAS the slot mutation on it still being VACANT with no auction. A
    // buyNow can claim a VACANT slot (→ OCCUPIED) between the findUnique
    // above and here; without this guard the blind update would wipe that
    // paid buy-now and re-auction the slot. On a lost race, back out the
    // auction row we just created so it doesn't dangle.
    const claim = await this.prisma.featuredSlot.updateMany({
      where: {
        id: slotId,
        status: FeaturedSlotStatus.VACANT,
        currentAuctionId: null,
      },
      data: {
        currentAuctionId: auction.id,
        status: FeaturedSlotStatus.AUCTION_RUNNING,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
      },
    });
    if (claim.count === 0) {
      await this.prisma.featuredAuction.delete({ where: { id: auction.id } });
      return;
    }
    await this.recordEvent(slotId, 'AUCTION_OPENED', {
      auctionId: auction.id,
      kind: 'AD_HOC',
    });
  }

  // Back-compat alias — the cron tick still references the old name
  // in some places. Both point at openAuction now. Will be cleaned
  // up when the cron is simplified in the same commit.
  async openAdHocAuction(slotId: string) {
    return this.openAuction(slotId);
  }

  // Closes an auction at its closesAt boundary. Picks the highest
  // ACTIVE bid as winner + opens the 15-min bind window. If zero
  // bids landed, closes with NO_BIDS and immediately reopens an
  // ad-hoc auction.
  async closeAuction(auctionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.featuredAuction.findUnique({
        where: { id: auctionId },
        include: { slot: true },
      });
      if (!auction) return;
      if (auction.status !== 'OPEN') return; // already closed

      const top = await tx.featuredSlotBid.findFirst({
        where: { auctionId, status: 'ACTIVE' },
        orderBy: { amountCents: 'desc' },
      });

      if (!top) {
        // CAS the auction transition on status OPEN. The auction row is
        // the single point both this cron and buyNow write, so if a
        // concurrent buyNow already closed+awarded it (its bids are now
        // LOST, so `top` read as null and we landed here), this matches 0
        // rows and we abort WITHOUT touching the slot buyNow just claimed.
        const closed = await tx.featuredAuction.updateMany({
          where: { id: auctionId, status: 'OPEN' },
          data: {
            status: FeaturedAuctionStatus.CLOSED_NO_BIDS,
            closedAt: new Date(),
          },
        });
        if (closed.count === 0) return; // buyNow (or another close) won it
        // Detach this auction from the slot and let the cron open a
        // fresh ad-hoc auction on the next tick. Guarded so we never
        // clobber a slot an admin award / buyNow moved off this auction.
        await tx.featuredSlot.updateMany({
          where: {
            id: auction.slotId,
            currentAuctionId: auctionId,
            status: FeaturedSlotStatus.AUCTION_RUNNING,
          },
          data: {
            currentAuctionId: null,
            status: FeaturedSlotStatus.VACANT,
          },
        });
        await this.recordEvent(auction.slotId, 'AUCTION_CLOSED', {
          auctionId,
          outcome: 'NO_BIDS',
        }, undefined, undefined, tx);
        return;
      }

      // Mark winning bid + losers in bulk. CAS the auction transition on
      // status OPEN (see above) so a concurrent buyNow that already
      // awarded this auction makes us a no-op instead of overwriting its
      // winner + clobbering the OCCUPIED slot.
      const closed = await tx.featuredAuction.updateMany({
        where: { id: auctionId, status: 'OPEN' },
        data: {
          status: FeaturedAuctionStatus.CLOSED_AWARDED,
          closedAt: new Date(),
          winningBidId: top.id,
        },
      });
      if (closed.count === 0) return; // buyNow (or another close) won it
      await tx.featuredSlotBid.updateMany({
        where: {
          auctionId,
          id: { not: top.id },
          status: 'ACTIVE',
        },
        data: { status: 'LOST' },
      });

      // Move slot into BIND_WINDOW. Promotion to OCCUPIED happens when
      // the winner calls bindListingToSlot. Cron expires the window
      // after bindWindowSec. Guarded on the slot still running THIS
      // auction so an admin award / buyNow that moved it off is not
      // overwritten (the auction stays CLOSED_AWARDED but harmless).
      await tx.featuredSlot.updateMany({
        where: {
          id: auction.slotId,
          currentAuctionId: auctionId,
          status: FeaturedSlotStatus.AUCTION_RUNNING,
        },
        data: { status: FeaturedSlotStatus.BIND_WINDOW },
      });

      await this.recordEvent(auction.slotId, 'AUCTION_CLOSED', {
        auctionId,
        outcome: 'AWARDED',
        winningBidId: top.id,
        winningAmountCents: top.amountCents,
      }, undefined, undefined, tx);
      await this.recordEvent(auction.slotId, 'BIND_WINDOW_OPENED', {
        winningBidId: top.id,
        winnerUserId: top.bidderId,
      }, undefined, undefined, tx);
    });
  }

  // Bind-window expired without the winner picking a listing. Cascade
  // to the next-highest bid in the same auction. If no runner-up,
  // open an ad-hoc auction immediately.
  async expireBindWindow(slotId: string) {
    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.featuredSlot.findUnique({
        where: { id: slotId },
        include: {
          currentAuction: { include: { winningBid: true } },
        },
      });
      if (!slot) return;
      if (slot.status !== 'BIND_WINDOW') return;
      const auction = slot.currentAuction;
      if (!auction) return;
      const forfeitedBid = auction.winningBid;
      const nowTs = new Date();
      // Absolute cap (re-arm squat): once the auction closed longer than
      // bindWindow + FEATURED_UNPAID_MAX_MS ago, an UNPAID winner is
      // forfeited even with a freshly re-armed paymentPayByAt. Paid winners
      // are NEVER force-forfeited here (they need admin force-evict).
      const cfg = await this.getConfig();
      const hardCapReached =
        auction.closedAt !== null &&
        auction.closedAt.getTime() <=
          nowTs.getTime() - (cfg.bindWindowSec * 1000 + FEATURED_UNPAID_MAX_MS);
      if (forfeitedBid) {
        // Review fix (TOCTOU): forfeit ATOMICALLY, gated on the bid still
        // being unpaid with a lapsed/absent window (or past the hard cap).
        // A confirmSlotPayment that set paidAt (or a re-bind that re-armed
        // paymentPayByAt) in the ms between the guard read above and this
        // write must abort the cascade — otherwise we'd WITHDRAW a paid bid
        // and strand the money while handing the slot to someone else.
        const windowGuard = hardCapReached
          ? {} // hard cap: any unpaid bid, regardless of re-armed window
          : {
              OR: [
                { paymentPayByAt: null },
                { paymentPayByAt: { lte: nowTs } },
              ],
            };
        const forfeit = await tx.featuredSlotBid.updateMany({
          where: {
            id: forfeitedBid.id,
            // The PRIMARY bind-window-expiry case is a winner who never
            // picked a listing — that bid is still ACTIVE (WON is only set
            // once bindListingToSlot runs). Include both, but paidAt:null +
            // windowGuard still protect a paid or in-window winner.
            status: { in: ['ACTIVE', 'WON'] },
            paidAt: null,
            ...windowGuard,
          },
          data: { status: 'WITHDRAWN' },
        });
        if (forfeit.count === 0) {
          // Paid or (non-hard-cap) re-armed under us — leave the slot as-is.
          return;
        }
      }
      await this.recordEvent(slotId, 'BIND_WINDOW_EXPIRED', {
        forfeitedBidId: forfeitedBid?.id ?? null,
      });

      // Cascade to next-highest ACTIVE bid in this auction.
      const runnerUp = await tx.featuredSlotBid.findFirst({
        where: { auctionId: auction.id, status: 'LOST' },
        orderBy: { amountCents: 'desc' },
      });
      if (runnerUp) {
        // Re-activate the runner-up and re-open a fresh bind window
        // by pointing the auction's winning bid at them.
        await tx.featuredSlotBid.update({
          where: { id: runnerUp.id },
          data: {
            status: 'ACTIVE',
            cascadedFromId: forfeitedBid?.id ?? null,
          },
        });
        // Review fix (runner-up burned on next tick): the cron keys the
        // bind-window timer off auction.closedAt, so re-pointing
        // winningBid without advancing closedAt would let the very next
        // EVERY_MINUTE tick forfeit the fresh winner immediately. Reset
        // closedAt to now so the runner-up gets the FULL bind window.
        await tx.featuredAuction.update({
          where: { id: auction.id },
          data: { winningBidId: runnerUp.id, closedAt: nowTs },
        });
        await this.recordEvent(slotId, 'CASCADED_TO_RUNNER_UP', {
          fromBidId: forfeitedBid?.id ?? null,
          toBidId: runnerUp.id,
        });
        // Slot stays in BIND_WINDOW with the new winner + a fresh
        // closedAt-based timer.
        return;
      }

      // No runner-up — open ad-hoc auction.
      await tx.featuredSlot.update({
        where: { id: slotId },
        data: {
          status: FeaturedSlotStatus.VACANT,
          currentAuctionId: null,
        },
      });
    });
  }

  // Listing sold mid-feature OR force-evicted: free the slot, log,
  // open an ad-hoc auction.
  async releaseSoldListing(listingId: string) {
    const slot = await this.prisma.featuredSlot.findFirst({
      where: { currentListingId: listingId },
    });
    if (!slot) return; // listing wasn't featured
    // CAS the free on currentListingId so two overlapping cron ticks can't
    // both free the same slot — the second would blow away the fresh ad-hoc
    // auction the first just attached (orphaning it). Only the pass that
    // still sees THIS listing occupying wins; the loser bails before opening
    // a duplicate auction. (Matches the CAS discipline on every other
    // featured-lifecycle write: closeAuction/openAuction/expireFeatured.)
    const freed = await this.prisma.featuredSlot.updateMany({
      where: { id: slot.id, currentListingId: listingId },
      data: {
        status: FeaturedSlotStatus.VACANT,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
        // Detach the finished auction — openAuction (below) and the cron
        // recycler both bail while currentAuctionId is still set, so a
        // slot freed with a stale auction id would never re-auction.
        currentAuctionId: null,
      },
    });
    if (freed.count === 0) return; // another pass already freed it
    await this.recordEvent(slot.id, 'LISTING_SOLD_FREES_SLOT', {
      listingId,
    });
    await this.openAdHocAuction(slot.id);
  }

  // Featured time elapsed naturally. Slot is freed; new auction was
  // already running and should have just closed (cron handles both).
  async expireFeatured(slotId: string) {
    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) return;
    if (!slot.featuredUntil) return;
    if (new Date() < slot.featuredUntil) return; // not yet
    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: {
        status: FeaturedSlotStatus.VACANT,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
        // Detach the just-finished auction (an auction-won OR buy-now slot
        // parks its awarded auction here). The cron recycler only opens a
        // fresh auction on slots with currentAuctionId:null, so leaving it
        // set would wedge the slot VACANT forever with no auction.
        currentAuctionId: null,
      },
    });
    await this.recordEvent(slotId, 'FEATURED_EXPIRED', {});
    // The EVERY_MINUTE cron recycler picks this freed slot up next tick
    // ({ status: VACANT, currentAuctionId: null }) and opens a fresh
    // AD_HOC auction — no need to open one inline here.
  }

  // ─── Admin actions ──────────────────────────────────────────────────

  async forceEvict(
    adminId: string,
    slotId: string,
    reason: string,
    refund: boolean,
  ) {
    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
      include: {
        currentAuction: { include: { winningBid: true } },
      },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    // Review fix: also allow eviction of a BIND_WINDOW slot. On the
    // manual-EFT rail a paid winner whose auto-bind failed (their pending
    // listing sold while the money was in flight) sits in BIND_WINDOW,
    // not OCCUPIED — without this, that slot had NO working admin escape.
    if (slot.status !== 'OCCUPIED' && slot.status !== 'BIND_WINDOW') {
      throw new BadRequestException(
        'Slot is not occupied or in a bind window',
      );
    }

    const bid = slot.currentAuction?.winningBid ?? null;
    let refunded = false;
    let manualRefundOwedCents = 0;

    if (refund && bid) {
      const refundCents = bid.chargedAmountCents ?? bid.amountCents;
      // Only a REAL gateway capture id can be reversed on the card. The
      // bind + buy-now paths currently stamp a synthetic placeholder
      // (`featured-<bidId>` / `featured-buynow-<bidId>`) because real
      // capture isn't wired yet (AUDIT H1) — calling the gateway with that
      // would fail AND falsely report refunded:true. Treat any `featured-`
      // placeholder like the EFT lane: no auto-reversal, owe a manual refund.
      const hasRealGatewayId =
        !!bid.peachPaymentId && !bid.peachPaymentId.startsWith('featured-');
      if (hasRealGatewayId) {
        // Paygate rail — reverse on the card via the gateway.
        const r = await this.peach.refundPayment(bid.peachPaymentId!, refundCents);
        await this.prisma.featuredSlotBid.update({
          where: { id: bid.id },
          data: { status: 'REFUNDED' },
        });
        refunded = true;
        await this.recordEvent(
          slotId,
          'REFUND_ISSUED',
          {
            bidId: bid.id,
            refundCents,
            faceAmountCents: bid.amountCents,
            discountPercent: bid.discountPercent,
            peachResult: r.resultCode,
          },
          undefined,
          adminId,
        );
      } else if (bid.paidAt) {
        // EFT-paid bids (no peachPaymentId) AND synthetic-placeholder
        // paygate bids (no real capture) have NO automatic reversal lane
        // for featured fees (the payout batch only covers Transactions).
        // Do NOT report refunded:true. Mark the bid REFUNDED (so it's out
        // of the WON set) and surface that the operator owes a manual
        // refund of refundCents.
        await this.prisma.featuredSlotBid.update({
          where: { id: bid.id },
          data: { status: 'REFUNDED' },
        });
        manualRefundOwedCents = refundCents;
        await this.recordEvent(
          slotId,
          'MANUAL_REFUND_OWED',
          {
            bidId: bid.id,
            refundCents,
            note: 'EFT-paid featured slot force-evicted — refund the bidder by manual EFT.',
          },
          undefined,
          adminId,
        );
      }
    }

    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: {
        status: FeaturedSlotStatus.VACANT,
        currentListingId: null,
        currentSellerId: null,
        currentAuctionId: null,
        featuredUntil: null,
      },
    });
    await this.recordEvent(slotId, 'FORCE_EVICTED', { reason }, undefined, adminId);
    await this.openAdHocAuction(slotId);
    return { evicted: true, refunded, manualRefundOwedCents };
  }

  async manuallyAward(
    adminId: string,
    slotId: string,
    listingIdOrRef: string,
    durationSeconds: number,
    reason: string,
  ) {
    // Admins typically type the human-readable reference number
    // (e.g. UM000123, AU000045, TS000007) rather than the internal
    // CUID. Accept either — try id first, fall back to
    // referenceNumber (case-insensitive). This avoids the "ID not
    // recognized" error when an admin grabs the visible reference
    // from the listing detail page chip.
    const trimmed = listingIdOrRef.trim();
    let listing = await this.prisma.listing.findUnique({
      where: { id: trimmed },
      select: { id: true, sellerId: true, status: true, isDealListing: true },
    });
    if (!listing) {
      listing = await this.prisma.listing.findUnique({
        where: { referenceNumber: trimmed.toUpperCase() },
        select: { id: true, sellerId: true, status: true, isDealListing: true },
      });
    }
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.isDealListing) {
      throw new BadRequestException('Daily Deals cannot be featured');
    }
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException('Listing must be ACTIVE');
    }

    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.status === 'OCCUPIED') {
      throw new BadRequestException(
        'Slot is occupied — force-evict first',
      );
    }

    const featuredUntil = new Date(Date.now() + durationSeconds * 1000);
    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: {
        status: FeaturedSlotStatus.OCCUPIED,
        currentListingId: listing.id,
        currentSellerId: listing.sellerId,
        featuredUntil,
        // Close any open auction on this slot — admin override wins.
        currentAuctionId: null,
      },
    });
    await this.recordEvent(
      slotId,
      'MANUALLY_AWARDED',
      {
        listingId: listing.id,
        listingInput: listingIdOrRef,
        durationSeconds,
        reason,
        featuredUntil: featuredUntil.toISOString(),
      },
      undefined,
      adminId,
    );
    return { featuredUntil };
  }

  async shiftFeaturedUntil(
    adminId: string,
    slotId: string,
    deltaSeconds: number,
    reason: string,
  ) {
    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.featuredUntil) {
      throw new BadRequestException('Slot has no featuredUntil to shift');
    }
    const next = new Date(slot.featuredUntil.getTime() + deltaSeconds * 1000);
    if (next <= new Date()) {
      throw new BadRequestException(
        'Shift would put featuredUntil in the past',
      );
    }
    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: { featuredUntil: next },
    });
    await this.recordEvent(
      slotId,
      'SHIFTED_FEATURED_UNTIL',
      { deltaSeconds, was: slot.featuredUntil.toISOString(), now: next.toISOString(), reason },
      undefined,
      adminId,
    );
    return { featuredUntil: next };
  }

  async closeAuctionEarly(adminId: string, slotId: string, reason: string) {
    const slot = await this.prisma.featuredSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot?.currentAuctionId) {
      throw new BadRequestException('No open auction on this slot');
    }
    await this.recordEvent(
      slotId,
      'AUCTION_CLOSED_EARLY',
      { auctionId: slot.currentAuctionId, reason },
      undefined,
      adminId,
    );
    await this.closeAuction(slot.currentAuctionId);
    return { closed: true };
  }

  async updateConfig(adminId: string, patch: Partial<Prisma.FeaturedSlotConfigUpdateInput>) {
    const updated = await this.prisma.featuredSlotConfig.update({
      where: { id: 'default' },
      data: { ...patch, updatedByAdminId: adminId },
    });
    await this.recordEvent(null, 'CONFIG_CHANGED', { patch }, undefined, adminId);
    return updated;
  }

  async banBidder(adminId: string, userId: string, reason: string) {
    await this.prisma.featuredSlotBidderBan.upsert({
      where: { userId },
      create: { userId, reason, bannedByAdminId: adminId },
      update: { reason, bannedByAdminId: adminId },
    });
    await this.recordEvent(null, 'BIDDER_BANNED', { userId, reason }, undefined, adminId);
    return { banned: true };
  }

  async unbanBidder(adminId: string, userId: string) {
    await this.prisma.featuredSlotBidderBan.deleteMany({ where: { userId } });
    await this.recordEvent(null, 'BIDDER_UNBANNED', { userId }, undefined, adminId);
    return { banned: false };
  }

  async listBannedBidders() {
    return this.prisma.featuredSlotBidderBan.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Admin reads ────────────────────────────────────────────────────

  async getAuditLog(opts: {
    slotId?: string;
    eventType?: string;
    limit?: number;
  } = {}) {
    return this.prisma.featuredSlotAuditEvent.findMany({
      where: {
        slotId: opts.slotId,
        eventType: opts.eventType,
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 200,
    });
  }

  async getRevenueStats() {
    const allPaid = await this.prisma.featuredSlotBid.findMany({
      where: { status: { in: ['WON', 'REFUNDED'] }, paidAt: { not: null } },
      select: {
        amountCents: true,
        // Phase E2 — admin revenue dashboard reads the cents we
        // actually collected, not the face bid. Falls back to the
        // face for pre-E2 bids that have chargedAmountCents = null.
        chargedAmountCents: true,
        discountPercent: true,
        paidAt: true,
        status: true,
        bidderId: true,
      },
    });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const billable = (b: { amountCents: number; chargedAmountCents: number | null }) =>
      b.chargedAmountCents ?? b.amountCents;

    const totalCents = allPaid
      .filter((b) => b.status === 'WON')
      .reduce((sum, b) => sum + billable(b), 0);
    const monthCents = allPaid
      .filter((b) => b.status === 'WON' && b.paidAt && b.paidAt >= monthStart)
      .reduce((sum, b) => sum + billable(b), 0);

    // Top bidders by paid spend.
    const byBidder = new Map<string, number>();
    for (const b of allPaid.filter((b) => b.status === 'WON')) {
      byBidder.set(b.bidderId, (byBidder.get(b.bidderId) ?? 0) + billable(b));
    }
    const topBidderIds = [...byBidder.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topBidders = await Promise.all(
      topBidderIds.map(async ([id, cents]) => {
        const u = await this.prisma.user.findUnique({
          where: { id },
          select: { username: true, email: true },
        });
        return { user: u, totalCents: cents };
      }),
    );

    // Auction stats.
    const closedAuctions = await this.prisma.featuredAuction.count({
      where: { status: { in: ['CLOSED_AWARDED', 'CLOSED_NO_BIDS'] } },
    });
    const awardedAuctions = await this.prisma.featuredAuction.count({
      where: { status: 'CLOSED_AWARDED' },
    });

    return {
      totalCents,
      monthCents,
      topBidders,
      closedAuctions,
      awardedAuctions,
      fillRate:
        closedAuctions > 0 ? awardedAuctions / closedAuctions : null,
    };
  }

  // ─── Internal: audit log writer ─────────────────────────────────────

  private async recordEvent(
    slotId: string | null,
    eventType: string,
    payload: unknown,
    actorUserId?: string,
    actorAdminId?: string,
    // When called INSIDE an interactive $transaction that holds a
    // conflicting row lock on the slot (bindListingToSlot writes the
    // @unique currentListingId; closeAuction's NO_BIDS branch writes the
    // @unique currentAuctionId), the audit INSERT MUST run on the SAME tx
    // client. On the base pooled client it takes the FK's FOR KEY SHARE on
    // a row the outer tx already holds FOR UPDATE → self-deadlock until the
    // interactive-tx timeout rolls the whole bind/close back. Defaults to
    // the base client for the many non-transactional callers.
    tx?: Prisma.TransactionClient,
  ) {
    const data = {
      slotId,
      eventType,
      payloadJson: payload == null ? null : JSON.stringify(payload),
      actorUserId,
      actorAdminId,
    };
    if (tx) {
      // On-transaction: the audit row is atomic with the slot mutation, so a
      // failure here MUST propagate and roll the whole bind/close back — never
      // swallow it. Swallowing on the tx client would either abort the tx
      // silently or let a phantom "success" return while nothing persisted
      // (adversarial-review fix).
      await tx.featuredSlotAuditEvent.create({ data });
      return;
    }
    // Base client (the many non-transactional callers): audit is best-effort;
    // a failure must never break the surrounding operation.
    try {
      await this.prisma.featuredSlotAuditEvent.create({ data });
    } catch (err) {
      this.logger.warn(`audit log failed: ${(err as Error).message}`);
    }
  }
}

function tierDuration(
  tier: FeaturedTier,
  cfg: { t1DurationSec: number; t2DurationSec: number; t3DurationSec: number; t4DurationSec: number; t5DurationSec: number },
): number {
  switch (tier) {
    case 'T1':
      return cfg.t1DurationSec;
    case 'T2':
      return cfg.t2DurationSec;
    case 'T3':
      return cfg.t3DurationSec;
    case 'T4':
      return cfg.t4DurationSec;
    case 'T5':
      return cfg.t5DurationSec;
  }
}

// Base (pre-discount, pre-multiplier) price of a tier from config.
// Used by Buy Now to derive the 2× premium; auction bids read the same
// amounts via snapToTier.
export function tierAmount(
  tier: FeaturedTier,
  cfg: { t1AmountCents: number; t2AmountCents: number; t3AmountCents: number; t4AmountCents: number; t5AmountCents: number },
): number {
  switch (tier) {
    case 'T1':
      return cfg.t1AmountCents;
    case 'T2':
      return cfg.t2AmountCents;
    case 'T3':
      return cfg.t3AmountCents;
    case 'T4':
      return cfg.t4AmountCents;
    case 'T5':
      return cfg.t5AmountCents;
  }
}
