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
import { StitchService } from '../payments/stitch.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';

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
    private readonly stitch: StitchService,
    // @Global — used by bindListingToSlot() to post a Sales Receipt
    // to Books for the featured-slot fee. Feature-flagged so it's
    // a no-op until ZOHO_BOOKS_ENABLED=true.
    private readonly zohoBooks: ZohoBooksService,
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
          where: { id: { in: ids } },
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

  // The 10 slots — what's currently featured (for the rail) + which
  // slot has an OPEN auction (for the bid page). Sorted by slotNumber
  // so the rail order is stable.
  async getRail() {
    return this.prisma.featuredSlot.findMany({
      orderBy: { slotNumber: 'asc' },
      include: {
        currentListing: {
          select: {
            id: true,
            title: true,
            price: true,
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
          featuredInSlot: { select: { id: true } },
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.sellerId !== user.id) {
        throw new ForbiddenException('Listing is not yours');
      }
      if (listing.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Listing must be ACTIVE to be featured',
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

      // AUDIT H1 — until a real Stitch (or successor gateway) charge
      // is wired here, the binding marks the bid PAID with a fabricated
      // id ("featured-<bidId>") which (a) gives away featuring for
      // free, (b) inflates the admin revenue dashboard with phantom
      // income, and (c) makes the force-evict path try to refund a
      // gateway payment that was never captured.
      //
      // Until real charging lands, refuse binding in production so we
      // can't accidentally hand out free homepage featuring. In
      // non-prod we keep the synthetic-id path so the lifecycle is
      // still exercisable end-to-end. Tracked on LAUNCH-CHECKLIST.md.
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
      }, user.id);
      await this.recordEvent(slot.id, 'FEATURED_LIVE', {
        listingId: listing.id,
        featuredUntil: featuredUntil.toISOString(),
      });

      // Zoho Books: post a Sales Receipt for the slot fee. Fire-and-
      // forget outside the DB transaction — Books failures don't
      // block the binding. Note: we use winningBid.id (captured
      // above) because by the time this fires, the bid has already
      // been updated to status=WON.
      void this.zohoBooks.createFeaturedSlotInvoice(winningBid.id);

      return { featuredUntil };
    });
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
    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: {
        currentAuctionId: auction.id,
        status: FeaturedSlotStatus.AUCTION_RUNNING,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
      },
    });
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
        await tx.featuredAuction.update({
          where: { id: auctionId },
          data: {
            status: FeaturedAuctionStatus.CLOSED_NO_BIDS,
            closedAt: new Date(),
          },
        });
        // Detach this auction from the slot and let the cron open a
        // fresh ad-hoc auction on the next tick.
        await tx.featuredSlot.update({
          where: { id: auction.slotId },
          data: {
            currentAuctionId: null,
            status: FeaturedSlotStatus.VACANT,
          },
        });
        await this.recordEvent(auction.slotId, 'AUCTION_CLOSED', {
          auctionId,
          outcome: 'NO_BIDS',
        });
        return;
      }

      // Mark winning bid + losers in bulk.
      await tx.featuredAuction.update({
        where: { id: auctionId },
        data: {
          status: FeaturedAuctionStatus.CLOSED_AWARDED,
          closedAt: new Date(),
          winningBidId: top.id,
        },
      });
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
      // after bindWindowSec.
      await tx.featuredSlot.update({
        where: { id: auction.slotId },
        data: { status: FeaturedSlotStatus.BIND_WINDOW },
      });

      await this.recordEvent(auction.slotId, 'AUCTION_CLOSED', {
        auctionId,
        outcome: 'AWARDED',
        winningBidId: top.id,
        winningAmountCents: top.amountCents,
      });
      await this.recordEvent(auction.slotId, 'BIND_WINDOW_OPENED', {
        winningBidId: top.id,
        winnerUserId: top.bidderId,
      });
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
      if (forfeitedBid) {
        await tx.featuredSlotBid.update({
          where: { id: forfeitedBid.id },
          data: { status: 'WITHDRAWN' },
        });
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
        await tx.featuredAuction.update({
          where: { id: auction.id },
          data: { winningBidId: runnerUp.id },
        });
        await this.recordEvent(slotId, 'CASCADED_TO_RUNNER_UP', {
          fromBidId: forfeitedBid?.id ?? null,
          toBidId: runnerUp.id,
        });
        // Slot stays in BIND_WINDOW with the new winner. Cron will
        // start a fresh bind window timer based on the auction's
        // updatedAt (or we could persist a separate bindWindowStartedAt
        // — left as a follow-up).
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
    await this.prisma.featuredSlot.update({
      where: { id: slot.id },
      data: {
        status: FeaturedSlotStatus.VACANT,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
      },
    });
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
      },
    });
    await this.recordEvent(slotId, 'FEATURED_EXPIRED', {});
    // Don't auto-open a new auction here — the SCHEDULED pre-auction
    // ran in parallel and either just closed (winner promoted in
    // closeAuction) or yielded NO_BIDS (handled there).
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
    if (slot.status !== 'OCCUPIED') {
      throw new BadRequestException('Slot is not currently occupied');
    }

    if (refund && slot.currentAuction?.winningBid?.peachPaymentId) {
      const bid = slot.currentAuction.winningBid;
      // Phase E2 — refund the amount we actually CHARGED (post-
      // discount), not the face bid. Fall back to amountCents for
      // legacy bids that were charged before the discount fields
      // existed.
      const refundCents = bid.chargedAmountCents ?? bid.amountCents;
      const r = await this.stitch.refundPayment(
        bid.peachPaymentId!,
        refundCents,
      );
      await this.prisma.featuredSlotBid.update({
        where: { id: bid.id },
        data: { status: 'REFUNDED' },
      });
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
    }

    await this.prisma.featuredSlot.update({
      where: { id: slotId },
      data: {
        status: FeaturedSlotStatus.VACANT,
        currentListingId: null,
        currentSellerId: null,
        featuredUntil: null,
      },
    });
    await this.recordEvent(slotId, 'FORCE_EVICTED', { reason }, undefined, adminId);
    await this.openAdHocAuction(slotId);
    return { evicted: true, refunded: refund };
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
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing) {
      listing = await this.prisma.listing.findUnique({
        where: { referenceNumber: trimmed.toUpperCase() },
        select: { id: true, sellerId: true, status: true },
      });
    }
    if (!listing) throw new NotFoundException('Listing not found');
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
  ) {
    try {
      await this.prisma.featuredSlotAuditEvent.create({
        data: {
          slotId,
          eventType,
          payloadJson:
            payload == null ? null : JSON.stringify(payload),
          actorUserId,
          actorAdminId,
        },
      });
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
