import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { PlaceBidDto } from './dto/place-bid.dto';
import { Prisma } from '@prisma/client';

const APP_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const AUCTION_WIN_CHECKOUT_TTL_HOURS = 24;

// Tiered bid increments per CLAUDE.md (M2 Auction System).
// Each entry is [upper bound (exclusive, ZAR cents), increment (ZAR cents)].
const INCREMENT_TIERS: ReadonlyArray<[number, number]> = [
  [100_000, 5_000], // <R1,000   → R50
  [500_000, 10_000], // <R5,000  → R100
  [1_000_000, 25_000], // <R10,000 → R250
  [5_000_000, 50_000], // <R50,000 → R500
];
const DEFAULT_INCREMENT = 100_000; // R1,000 for >=R50,000

// Snipe-protection window — a bid placed within this window of endTime
// pushes endTime out by the same amount.
const SNIPE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export function bidIncrement(currentAmount: number): number {
  for (const [bound, inc] of INCREMENT_TIERS) {
    if (currentAmount < bound) return inc;
  }
  return DEFAULT_INCREMENT;
}

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    // @Global so no module import needed. Used to mint
    // AUCTION_BID + CHECKOUT tokens so the recipient of the outbid
    // / win SMS can act from the link without signing in.
    private readonly actionTokens: ActionTokensService,
  ) {}

  // --- Public read endpoints --------------------------------------------

  // Public-safe view of an auction. Hides reservePrice; only exposes whether
  // it's been met. Includes recent bids with bidders' names but NOT max amounts.
  async getAuctionState(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        listingType: true,
        status: true,
        price: true, // starting bid
        buyNowPrice: true,
        currentBid: true,
        currentBidderId: true,
        bidCount: true,
        reserveMet: true,
        reservePrice: true, // we'll strip from the response below
        startTime: true,
        endTime: true,
        endedAt: true,
        sellerId: true,
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.listingType !== 'AUCTION') {
      throw new BadRequestException('Not an auction');
    }

    const recentBids = await this.prisma.bid.findMany({
      where: { listingId },
      // Secondary id-desc tiebreak so two rows created in the same
      // transaction (new bidder + proxy counter) keep the counter on
      // top of the attempt when timestamps match to the millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        amount: true,
        maxAmount: true,
        createdAt: true,
        bidder: { select: { username: true } },
      },
    });

    // Use the bidder's chosen username for the auction surface — never
    // first/last name. Real identity stays inside KYC / transaction
    // records only.
    let currentBidderName: string | null = null;
    if (listing.currentBidderId) {
      const bidder = await this.prisma.user.findUnique({
        where: { id: listing.currentBidderId },
        select: { username: true },
      });
      if (bidder) {
        currentBidderName = bidder.username
          ? bidder.username
          : 'Anonymous bidder';
      }
    }

    return {
      id: listing.id,
      status: listing.status,
      startingBid: listing.price,
      buyNowPrice: listing.bidCount === 0 ? listing.buyNowPrice : null,
      currentBid: listing.currentBid,
      currentBidderName,
      bidCount: listing.bidCount,
      reserveMet: listing.reserveMet,
      hasReserve: listing.reservePrice !== null,
      startTime: listing.startTime,
      endTime: listing.endTime,
      endedAt: listing.endedAt,
      nextMinBid: this.nextMinBid(listing.currentBid, listing.price),
      recentBids: recentBids.map((b) => ({
        id: b.id,
        amount: b.amount,
        bidderName: b.bidder.username ? b.bidder.username : 'Anonymous',
        // Legacy data only — new bids write the proxy counter as its
        // own row attributed to the proxy holder, so wasCountered is
        // false for any bid placed after this change. Historic rows
        // with amount > maxAmount still get tagged so older auction
        // history reads correctly.
        wasCountered: b.amount > b.maxAmount,
        createdAt: b.createdAt,
      })),
    };
  }

  // ─── Cancel an active proxy bid ─────────────────────────────────────
  // The user keeps their lead at the current visible bid amount but
  // their proxy stops auto-countering future bidders. Implemented by
  // posting a fresh Bid row with maxAmount === visible bid, so the
  // next opposing bid finds zero headroom on the prevHighMax lookup.
  // The user can re-raise their max later by hitting Auto Bid again.
  async cancelProxy(clerkId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) throw new ForbiddenException('User not synced');

    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          listingType: true,
          status: true,
          currentBid: true,
          currentBidderId: true,
          endedAt: true,
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.listingType !== 'AUCTION') {
        throw new BadRequestException('Not an auction');
      }
      if (listing.status !== 'ACTIVE' || listing.endedAt) {
        throw new BadRequestException('Auction is not active');
      }
      if (listing.currentBidderId !== buyer.id) {
        throw new ForbiddenException(
          'Only the current high bidder can cancel a proxy bid',
        );
      }
      const visible = listing.currentBid ?? 0;
      if (visible <= 0) {
        throw new BadRequestException('No active bid to cancel');
      }

      // Find their latest bid to confirm there's actually proxy
      // headroom to cancel. If max already equals the visible bid the
      // proxy is already cancelled — no-op.
      const latest = await tx.bid.findFirst({
        where: { listingId, bidderId: buyer.id },
        orderBy: { createdAt: 'desc' },
        select: { maxAmount: true },
      });
      if (!latest || latest.maxAmount <= visible) {
        return { cancelled: false, alreadyCancelled: true, currentBid: visible };
      }

      // Post the cancellation as a new Bid row — keeps the audit trail
      // honest. amount = visible (no change to listing.currentBid),
      // maxAmount = visible (no headroom).
      await tx.bid.create({
        data: {
          listingId,
          bidderId: buyer.id,
          amount: visible,
          maxAmount: visible,
        },
      });

      return { cancelled: true, currentBid: visible };
    });
  }

  // ─── Per-user proxy state for a single listing ─────────────────────
  // Returns the signed-in user's current proxy state on this listing:
  // their stored max, whether they're the high bidder, and whether
  // their proxy still has headroom above the visible bid ("active").
  // Used to label the Auto Bid button on the listing detail page —
  // "Auto bid · ACTIVE · R500" when the user has a live proxy with
  // room to counter, plain "Auto bid" otherwise.
  async getMyBidForListing(clerkId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) return null;

    // Most recent bid by this user on this listing — its maxAmount is
    // their stored proxy ceiling. (Older bids' maxAmounts can be
    // ignored; each new bid overwrites the effective max.)
    const latest = await this.prisma.bid.findFirst({
      where: { listingId, bidderId: buyer.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, maxAmount: true, amount: true },
    });
    if (!latest) {
      return { hasBid: false, maxAmount: null, isHighBidder: false, proxyActive: false };
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { currentBid: true, currentBidderId: true, endedAt: true },
    });
    if (!listing) {
      return { hasBid: true, maxAmount: latest.maxAmount, isHighBidder: false, proxyActive: false };
    }

    const isHighBidder = listing.currentBidderId === buyer.id;
    // Proxy is "active" only if the user is still the high bidder AND
    // their max is higher than the visible bid (so there's room to
    // auto-counter the next bidder). Once the auction ends, proxies
    // stop being active regardless.
    const proxyActive =
      !listing.endedAt &&
      isHighBidder &&
      latest.maxAmount > (listing.currentBid ?? 0);

    return {
      hasBid: true,
      maxAmount: latest.maxAmount,
      isHighBidder,
      proxyActive,
    };
  }

  // The minimum maxAmount a new bid must clear.
  private nextMinBid(currentBid: number | null, startingBid: number | null): number {
    if (currentBid === null || currentBid === 0) {
      return startingBid ?? 100;
    }
    return currentBid + bidIncrement(currentBid);
  }

  // --- Place a bid -------------------------------------------------------

  async placeBid(clerkId: string, listingId: string, dto: PlaceBidDto) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) throw new ForbiddenException('User not synced');
    if (buyer.isBanned) throw new ForbiddenException('Account suspended');
    if (buyer.auctionStrikes >= 3) {
      throw new ForbiddenException('Bidding suspended — three strikes for non-payment');
    }

    // All bid logic runs in a transaction so the proxy-bidding calculation
    // is atomic against concurrent bids.
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          sellerId: true,
          listingType: true,
          status: true,
          price: true,
          reservePrice: true,
          currentBid: true,
          currentBidderId: true,
          bidCount: true,
          reserveMet: true,
          endTime: true,
          buyNowPrice: true,
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.listingType !== 'AUCTION') {
        throw new BadRequestException('Not an auction');
      }
      if (listing.status !== 'ACTIVE') {
        throw new BadRequestException('Auction is not active');
      }
      if (listing.sellerId === buyer.id) {
        throw new ForbiddenException('Cannot bid on your own auction');
      }
      const now = new Date();
      if (!listing.endTime || now >= listing.endTime) {
        throw new BadRequestException('Auction has ended');
      }

      const startingBid = listing.price ?? 100;
      const minNewBid = this.nextMinBid(listing.currentBid, startingBid);
      if (dto.maxAmount < minNewBid) {
        throw new BadRequestException(
          `Maximum must be at least R${(minNewBid / 100).toFixed(2)}`,
        );
      }

      // Find the existing high bidder's stored max (proxy ceiling).
      let prevHighMax = 0;
      if (listing.currentBidderId) {
        const prev = await tx.bid.findFirst({
          where: { listingId, bidderId: listing.currentBidderId },
          orderBy: { createdAt: 'desc' },
          select: { maxAmount: true },
        });
        prevHighMax = prev?.maxAmount ?? 0;
      }

      // Bid resolution — branches on isOneShot.
      // ---------------------------------------------------------------
      // PLACE BID (one-shot): user wants their visible bid to equal
      // `maxAmount` right now, no proxy leak-out. We post `maxAmount`
      // as both the visible bid and the proxy ceiling. If they get
      // outbid later they won't be auto-countered above this value —
      // that's the whole point of one-shot.
      //
      // AUTO BID (default): standard proxy with three outcomes —
      //   A) New bidder's max > previous high's max → new bidder wins;
      //      visible bid = min(new max, prevHighMax + increment).
      //   B) New bidder's max <= prev high's max → prev high still wins;
      //      visible bid = min(prevHighMax, new max + increment).
      //   C) Same bidder is just raising their own ceiling — quietly
      //      update maxAmount, do not change visible bid.
      // ---------------------------------------------------------------
      const isSameBidder = listing.currentBidderId === buyer.id;
      const currentBid = listing.currentBid ?? 0;
      const isOneShot = dto.isOneShot === true;

      let visibleBid: number;
      let newHighBidderId: string;
      let outbidUserId: string | null = null;
      // proxyCountered — existing proxy WINS the duel; new bidder
      // loses below their visible amount. Two rows recorded: new
      // bidder's losing attempt + existing proxy's auto-counter.
      let proxyCountered = false;
      // proxyExhausted — existing proxy LOSES the duel because the
      // new bidder's max is higher. The existing proxy still fought
      // up to its stored max before being beaten, so we record that
      // "last stand" as its own row + the new bidder's winning row.
      // Without this, an outbid proxy holder vanishes from the bid
      // history at their starting visible amount, hiding the duel.
      let proxyExhausted = false;

      if (isOneShot) {
        // PLACE BID semantics — the bidder explicitly posts a single
        // visible amount and won't be auto-countered above it later.
        // BUT a Place Bid must STILL respect the existing high
        // bidder's proxy. Posting R150 cannot defeat a stored max of
        // R500 just because the new bidder asked for it — that would
        // make proxy bidding meaningless.
        //
        //   • If dto.maxAmount > prevHighMax → Place Bid wins. Post
        //     the bidder's exact amount as visible (no proxy gap; that
        //     IS the point of one-shot — show your hand).
        //   • Otherwise → existing proxy wins. Visible jumps to the
        //     normal proxy outcome: min(prevHighMax, maxAmount + inc).
        //     The new bidder's max is locked at their stated amount
        //     (so future opposing bids won't auto-counter them above).
        if (dto.maxAmount > prevHighMax) {
          visibleBid = dto.maxAmount;
          if (visibleBid < startingBid) visibleBid = startingBid;
          newHighBidderId = buyer.id;
          if (listing.currentBidderId && listing.currentBidderId !== buyer.id) {
            outbidUserId = listing.currentBidderId;
            // Beaten proxy holder gets a last-stand row if they had
            // an actual proxy ceiling above R0.
            if (prevHighMax > 0) proxyExhausted = true;
          }
        } else {
          const inc = bidIncrement(dto.maxAmount);
          visibleBid = Math.min(prevHighMax, dto.maxAmount + inc);
          newHighBidderId = listing.currentBidderId!;
          proxyCountered = true;
        }
      } else if (isSameBidder) {
        // Just raising your own ceiling — visible bid stays.
        visibleBid = currentBid > 0 ? currentBid : startingBid;
        newHighBidderId = buyer.id;
        // Persist the raised maxAmount via a new Bid row so history is honest.
      } else if (dto.maxAmount > prevHighMax) {
        // New bidder beats stored max.
        const inc = bidIncrement(prevHighMax > 0 ? prevHighMax : startingBid);
        const proposed = (prevHighMax > 0 ? prevHighMax : startingBid - inc) + inc;
        visibleBid = Math.min(dto.maxAmount, proposed);
        // First bid scenario — visible bid is at least startingBid.
        if (visibleBid < startingBid) visibleBid = startingBid;
        newHighBidderId = buyer.id;
        outbidUserId = listing.currentBidderId; // might be null on first bid
        // Beaten proxy holder gets a last-stand row (Auto Bid vs Auto
        // Bid duels are now fully visible in the bid history).
        if (listing.currentBidderId && prevHighMax > 0) {
          proxyExhausted = true;
        }
      } else {
        // Existing high holds — proxy auto-counters.
        const inc = bidIncrement(dto.maxAmount);
        visibleBid = Math.min(prevHighMax, dto.maxAmount + inc);
        newHighBidderId = listing.currentBidderId!;
        proxyCountered = true;
      }

      // Snipe protection — bid in last 2 mins pushes endTime out by 2 mins.
      const newEndTime =
        listing.endTime.getTime() - now.getTime() < SNIPE_WINDOW_MS
          ? new Date(now.getTime() + SNIPE_WINDOW_MS)
          : listing.endTime;

      const reserveMet =
        listing.reservePrice !== null && visibleBid >= listing.reservePrice;

      // Record the bid(s). Three cases:
      //
      // 1) proxyCountered — existing proxy WINS the duel. Insert order
      //    (chronological): new bidder's losing attempt FIRST, then
      //    the existing proxy's counter on top. Bid history shows the
      //    counter most recent, the loser's attempt right below.
      //
      // 2) proxyExhausted — new bidder BEATS the existing proxy. The
      //    beaten proxy still fought to its max before falling, so we
      //    insert the proxy's last-stand row FIRST, then the new
      //    bidder's winning row on top. History reads:
      //      • new bidder wins at (existing max + inc)
      //      • existing proxy's last stand at its max
      //
      // 3) Neither — first bid OR same bidder raising their own
      //    ceiling. Single row.
      if (proxyCountered && listing.currentBidderId) {
        await tx.bid.create({
          data: {
            listingId,
            bidderId: buyer.id,
            amount: dto.maxAmount,
            maxAmount: dto.maxAmount,
          },
        });
        await tx.bid.create({
          data: {
            listingId,
            bidderId: listing.currentBidderId,
            amount: visibleBid,
            maxAmount: prevHighMax,
          },
        });
      } else if (proxyExhausted && listing.currentBidderId) {
        await tx.bid.create({
          data: {
            listingId,
            bidderId: listing.currentBidderId,
            amount: prevHighMax,
            maxAmount: prevHighMax,
          },
        });
        await tx.bid.create({
          data: {
            listingId,
            bidderId: buyer.id,
            amount: visibleBid,
            maxAmount: dto.maxAmount,
          },
        });
      } else {
        await tx.bid.create({
          data: {
            listingId,
            bidderId: buyer.id,
            amount: visibleBid,
            maxAmount: dto.maxAmount,
          },
        });
      }

      // Update listing snapshot. bidCount increments by 2 for any
      // dual-row case (proxyCountered OR proxyExhausted), 1 otherwise,
      // so the count always matches the visible rows in the bid log.
      const dualRow = proxyCountered || proxyExhausted;
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: {
          currentBid: visibleBid,
          currentBidderId: newHighBidderId,
          bidCount: { increment: dualRow ? 2 : 1 },
          reserveMet,
          endTime: newEndTime,
        },
        select: {
          currentBid: true,
          currentBidderId: true,
          bidCount: true,
          reserveMet: true,
          endTime: true,
        },
      });

      // Fire-and-forget notifications (outside the transaction is preferable,
      // but for simplicity we do it after; the tx itself has already committed
      // by the time .then resolves on these calls).
      if (outbidUserId && outbidUserId !== buyer.id) {
        void this.notifyOutbid(outbidUserId, listingId, visibleBid);
      }
      void this.notifyBidPlaced(listing.sellerId, listingId, visibleBid);
      // Inbox: the user just bid higher on this auction — clear any
      // unresolved "you've been outbid" rows for them on this listing.
      // Stops the bell badge from showing a stale outbid alert after
      // they've already responded to it.
      void this.notifications.resolveByEntity('listing', listingId, {
        userId: buyer.id,
      });

      return {
        currentBid: updated.currentBid,
        bidCount: updated.bidCount,
        reserveMet: updated.reserveMet,
        endTime: updated.endTime,
        youAreHighBidder: updated.currentBidderId === buyer.id,
      };
    });
  }

  // --- Buy Now (auction with zero bids only) -----------------------------

  async buyNow(clerkId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) throw new ForbiddenException('User not synced');

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        listingType: true,
        status: true,
        bidCount: true,
        buyNowPrice: true,
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.listingType !== 'AUCTION') {
      throw new BadRequestException('Not an auction');
    }
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException('Auction is not active');
    }
    if (listing.sellerId === buyer.id) {
      throw new ForbiddenException('Cannot buy your own listing');
    }
    if (listing.bidCount > 0) {
      throw new BadRequestException('Buy Now is no longer available — bidding has started');
    }
    if (!listing.buyNowPrice) {
      throw new BadRequestException('This auction does not offer Buy Now');
    }

    // We don't create the Transaction here — the buyer goes through the same
    // /checkout flow as a BUY_NOW listing. Instead, we just flag the listing
    // so the checkout page knows to use buyNowPrice instead of price.
    return {
      checkoutAmount: listing.buyNowPrice,
      listingId: listing.id,
    };
  }

  // --- Buyer's own bids -------------------------------------------------

  async getMyBids(clerkId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!buyer) throw new ForbiddenException('User not synced');

    // One row per listing the buyer has bid on, with their latest max + listing state.
    const myBids = await this.prisma.bid.findMany({
      where: { bidderId: buyer.id },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            status: true,
            currentBid: true,
            currentBidderId: true,
            endTime: true,
            endedAt: true,
            reserveMet: true,
            price: true,
            images: { where: { isPrimary: true }, take: 1 },
          },
        },
      },
    });

    // Deduplicate by listing — keep only the most recent bid per listing.
    const seen = new Set<string>();
    const rows = myBids
      .filter((b) => {
        if (seen.has(b.listingId)) return false;
        seen.add(b.listingId);
        return true;
      })
      .map((b) => ({
        bidId: b.id,
        listingId: b.listing.id,
        listingTitle: b.listing.title,
        listingStatus: b.listing.status,
        listingImage: b.listing.images[0]?.url ?? null,
        myMaxAmount: b.maxAmount,
        myLastBidAmount: b.amount,
        currentBid: b.listing.currentBid,
        reserveMet: b.listing.reserveMet,
        endTime: b.listing.endTime,
        endedAt: b.listing.endedAt,
        youAreHighBidder: b.listing.currentBidderId === buyer.id,
        isWinner: b.isWinner,
      }));

    return rows;
  }

  // --- Watchlist --------------------------------------------------------

  async watch(clerkId: string, listingId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    await this.prisma.auctionWatch.upsert({
      where: { listingId_userId: { listingId, userId: user.id } },
      create: { listingId, userId: user.id },
      update: {},
    });
    return { watching: true };
  }

  async unwatch(clerkId: string, listingId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced');
    await this.prisma.auctionWatch.deleteMany({
      where: { listingId, userId: user.id },
    });
    return { watching: false };
  }

  // --- End auctions cron ------------------------------------------------

  // Called every minute by TasksService. Idempotent on endedAt — only
  // processes auctions whose endTime has passed and endedAt is null.
  async endStale() {
    const now = new Date();

    const candidates = await this.prisma.listing.findMany({
      where: {
        listingType: 'AUCTION',
        status: 'ACTIVE',
        endTime: { lt: now },
        endedAt: null,
      },
      select: {
        id: true,
        sellerId: true,
        currentBid: true,
        currentBidderId: true,
        bidCount: true,
        reserveMet: true,
        reservePrice: true,
      },
    });

    if (candidates.length === 0) return { processed: 0 };

    let processed = 0;
    for (const a of candidates) {
      try {
        await this.finalizeAuction(a.id);
        processed += 1;
      } catch (err) {
        this.logger.error(`Failed to finalize auction ${a.id}:`, err);
      }
    }
    return { processed };
  }

  private async finalizeAuction(listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          sellerId: true,
          title: true,
          currentBid: true,
          currentBidderId: true,
          bidCount: true,
          reserveMet: true,
          reservePrice: true,
          endedAt: true,
          status: true,
        },
      });
      if (!listing || listing.endedAt) return; // already processed
      if (listing.status !== 'ACTIVE') return;

      const now = new Date();

      // Case A: bids exist AND reserve met (or no reserve) → winner!
      if (
        listing.bidCount > 0 &&
        listing.currentBidderId &&
        (listing.reservePrice === null || listing.reserveMet)
      ) {
        await tx.listing.update({
          where: { id: listingId },
          data: {
            status: 'PAYMENT_PENDING',
            endedAt: now,
            // Buyer has 24h to pay — reuse expiresAt as the pay window
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
        // Mark the winning bid
        const winningBid = await tx.bid.findFirst({
          where: { listingId, bidderId: listing.currentBidderId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (winningBid) {
          await tx.bid.update({
            where: { id: winningBid.id },
            data: { isWinner: true },
          });
        }
        // Notifications fire after the tx commits
        void this.notifyAuctionWon(listing.currentBidderId, listingId, listing.currentBid!);
        void this.notifyAuctionEndedSeller(listing.sellerId, listingId, 'WON', listing.currentBid!);
        return;
      }

      // Case B: bids exist but reserve NOT met → seller decides
      if (listing.bidCount > 0 && !listing.reserveMet) {
        await tx.listing.update({
          where: { id: listingId },
          data: { status: 'EXPIRED', endedAt: now },
        });
        void this.notifyAuctionEndedSeller(listing.sellerId, listingId, 'NO_RESERVE', listing.currentBid ?? 0);
        return;
      }

      // Case C: no bids
      await tx.listing.update({
        where: { id: listingId },
        data: { status: 'EXPIRED', endedAt: now },
      });
      void this.notifyAuctionEndedSeller(listing.sellerId, listingId, 'NO_BIDS', 0);
    });
  }

  // --- Notification fan-out (thin wrappers; safe to fail silently) ------

  private async notifyBidPlaced(sellerId: string, listingId: string, amount: number) {
    try {
      const seller = await this.prisma.user.findUnique({ where: { id: sellerId } });
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!seller || !listing) return;
      // SMS + email per CLAUDE.md every-event rule.
      await this.notifications.bidPlaced(
        seller.email,
        listing.title,
        amount,
        seller.phone,
        listingId,
      );
    } catch (err) {
      this.logger.warn(`bidPlaced notify failed: ${(err as Error).message}`);
    }
  }

  private async notifyOutbid(userId: string, listingId: string, newAmount: number) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!user || !listing) return;
      // Mint an AUCTION_BID token so the outbid user can raise from
      // the SMS link. Token expires at the auction's endTime (snipe
      // extensions naturally extend the auction; we re-mint per
      // outbid event so each SMS carries a fresh token aligned with
      // the auction's current endTime at the moment we send).
      const token = await this.actionTokens
        .mint({
          purpose: 'AUCTION_BID',
          targetType: 'listing',
          targetId: listing.id,
          authorisedUserId: userId,
          expiresAt: listing.endTime ?? new Date(Date.now() + 24 * 3600_000),
        })
        .catch((err) => {
          this.logger.warn(`AUCTION_BID token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.bidOutbid(
        user.email,
        listing.title,
        newAmount,
        user.phone,
        listingId,
        token ? `${APP_URL}/a/${token}` : undefined,
      );
    } catch (err) {
      this.logger.warn(`outbid notify failed: ${(err as Error).message}`);
    }
  }

  private async notifyAuctionWon(userId: string, listingId: string, amount: number) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!user || !listing) return;
      // Auction won → mint a CHECKOUT token for the winner so the
      // SMS link drops them straight on the checkout page (no
      // sign-in). 24h TTL matches the "pay within 24h" rule.
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: listing.id,
          authorisedUserId: userId,
          expiresAt: new Date(Date.now() + AUCTION_WIN_CHECKOUT_TTL_HOURS * 3600_000),
          metadata: { auctionWinAmount: amount },
        })
        .catch((err) => {
          this.logger.warn(`Auction-win CHECKOUT token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.auctionWon(
        user.email,
        listing.title,
        amount,
        user.phone,
        listingId,
        token ? `${APP_URL}/a/${token}` : undefined,
      );
    } catch (err) {
      this.logger.warn(`auctionWon notify failed: ${(err as Error).message}`);
    }
  }

  private async notifyAuctionEndedSeller(
    sellerId: string,
    listingId: string,
    outcome: 'WON' | 'NO_RESERVE' | 'NO_BIDS',
    amount: number,
  ) {
    try {
      const seller = await this.prisma.user.findUnique({ where: { id: sellerId } });
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!seller || !listing) return;
      await this.notifications.auctionEndedForSeller(seller.email, listing.title, outcome, amount);
    } catch (err) {
      this.logger.warn(`auctionEnded notify failed: ${(err as Error).message}`);
    }
  }
}
