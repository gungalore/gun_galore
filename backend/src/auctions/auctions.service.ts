import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { ActivityService } from '../activity/activity.service';
import { INDEXES, SearchService } from '../search/search.service';
import { PlaceBidDto } from './dto/place-bid.dto';
import {
  assertAccountNotClosed,
  isAccountClosed,
} from '../common/account-standing';
import { assertContactVerified } from '../common/contact-verification';
import { Prisma } from '@prisma/client';

// Lazy getter — must NOT be a module-level constant. ES module imports
// hoist before main.ts's dotenv.config() runs, so a top-level
// `const APP_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'`
// captures `undefined` and falls back to localhost. SMS token URLs
// then go out as http://localhost:3000/a/<token> to live users.
// Calling the function at use-time defers the env read until after
// dotenv has populated process.env.
const APP_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:3000';
const AUCTION_WIN_CHECKOUT_TTL_HOURS = 24;

// Superset of ListingsService.PUBLICLY_VISIBLE_STATUSES. The public PDP 404s
// an EXPIRED listing, but this endpoint still serves its final state so a
// bidder can see how the auction closed (the /listings/<id>/result page and
// every ended-auction notification link depend on it since the 2026-11 audit).
// DRAFT / PENDING_REVIEW must 404 here too rather than confirm the row exists.
// CANCELLED is included so an already-open auction panel and the result page
// can render a terminal "cancelled" state instead of a permanent reconnect
// loop (2026-11 audit M12).
const AUCTION_PUBLIC_STATUSES = [
  'ACTIVE',
  'PAYMENT_PENDING',
  'SOLD',
  'EXPIRED',
  'CANCELLED',
];

// How long the seller has to decide whether to offer an expired-win auction
// to the runner-up. Short on purpose: the runner-up's interest (and the
// relevance of their bid) decays fast once the auction is over.
const RUNNER_UP_DECISION_HOURS = 48;

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

// Masks a bidder's username for the PUBLIC auction payload
// (GET /auctions/:listingId). A full username is a searchable handle,
// and here it's attached to a live bid on a firearm — showing it in
// full is worse than not showing a name at all. Must run server-side:
// a client-side mask is bypassed by anyone calling the API directly.
// (GET /auctions/:listingId/me — the signed-in bidder's own view of
// their own bid — intentionally does NOT call this.)
//
// Keeps the first character, and the last character too IF there's an
// actual middle to hide, joined by a FIXED-length run of asterisks —
// fixed rather than proportional to the real length, so the mask
// doesn't itself leak how long the username is (design boards:
// "r***b", "KloofM***").
//   - null/empty username → the caller's fallback (bidder may not
//     have set a username at all)
//   - 1-2 characters       → first char + '***'. A 2-char name has no
//     middle: first-and-last together would just print the whole
//     username back out, so only the first character survives.
//   - 3+ characters        → first char + '***' + last char, e.g.
//     "robert" → "r***t", "KM" → "K***", "Bo" → "B***".
export function maskBidderUsername(
  username: string | null | undefined,
  fallback = 'Anonymous bidder',
): string {
  if (!username) return fallback;
  const first = username[0];
  if (username.length <= 2) return `${first}***`;
  const last = username[username.length - 1];
  return `${first}***${last}`;
}

// Thrown inside the bid transaction when the compare-and-swap on the
// listing snapshot fails — i.e. a concurrent bid (or the end-of-auction
// sweep) changed the auction between our read and our write. Aborting
// the transaction rolls the Bid rows back too; the caller re-reads and
// re-resolves from fresh state, which is exactly the correct semantics
// for a lost race.
class BidConflictError extends Error {
  constructor() {
    super('auction state moved during bid resolution');
  }
}

// How many times placeBid re-runs its transaction after a CAS conflict
// before giving up. Conflicts cluster in the sniping window; two
// retries with jitter comfortably absorbs human-scale contention.
const BID_RETRY_ATTEMPTS = 3;

// What a finalized auction turned into. The notifications that follow are
// fired ONLY after the transaction commits, so a rolled-back finalize can
// never email/SMS a winner who was not actually recorded.
type AuctionFinalizeOutcome =
  | { kind: 'WON'; sellerId: string; winnerId: string; amount: number }
  | { kind: 'NO_RESERVE'; sellerId: string; amount: number }
  | { kind: 'NO_BIDS'; sellerId: string; amount: number }
  | null;

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
    private readonly activity: ActivityService,
    // @Global (SearchModule), so no module import is needed. Used to evict a
    // finalized auction from the listings index — see finalizeAuction().
    private readonly search: SearchService,
  ) {}

  // --- Public read endpoints --------------------------------------------

  // Public-safe view of an auction. Hides reservePrice; only exposes whether
  // it's been met. Includes recent bids with bidders' names but NOT max amounts.
  async getAuctionState(listingId: string, userId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        listingType: true,
        status: true,
        publicVisible: true,
        price: true, // starting bid
        currentBid: true,
        currentBidderId: true,
        bidCount: true,
        reserveMet: true,
        reservePrice: true, // we'll strip from the response below
        startTime: true,
        endTime: true,
        endedAt: true,
        sellerId: true,
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.listingType !== 'AUCTION') {
      throw new BadRequestException('Not an auction');
    }
    // Same status contract as the listing detail endpoint: a hidden or
    // unapproved auction is indistinguishable from a missing one. Access
    // (18+ declaration or member session) is enforced by ContentAccessGuard
    // before the handler, not here — content no longer varies by sign-in.
    if (!AUCTION_PUBLIC_STATUSES.includes(listing.status)) {
      throw new NotFoundException('Listing not found');
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
    // records only. Masked (see maskBidderUsername) because this is the
    // PUBLIC endpoint — a full username is a lookup handle, and people
    // are bidding against each other here.
    let currentBidderName: string | null = null;
    if (listing.currentBidderId) {
      const bidder = await this.prisma.user.findUnique({
        where: { id: listing.currentBidderId },
        select: { username: true },
      });
      if (bidder) {
        currentBidderName = maskBidderUsername(bidder.username);
      }
    }

    return {
      id: listing.id,
      // Title + primary image are public on the PDP already; the result page
      // (which is how a bidder sees an EXPIRED/CANCELLED auction after the PDP
      // starts 404ing) needs them.
      title: listing.title,
      primaryImageUrl: listing.images[0]?.url ?? null,
      status: listing.status,
      // The client cannot trust the device clock for a money countdown: a phone
      // whose clock is minutes ahead hid every bid CTA while the server still
      // accepted bids (2026-11 audit L14). The panel derives an offset from
      // this stamp and drives the countdown/close state off server time.
      serverNow: new Date().toISOString(),
      startingBid: listing.price,
      // Auction fixed-price option is retired: the sell form no longer offers it, the
      // API rejects it, and checkout's auction path is for winners only.
      // Keep it out of the payload so no client re-adds a dead CTA.
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
        // Masked — same reason as currentBidderName above (this is the
        // PUBLIC payload). Fallback text kept as-is ('Anonymous', not
        // 'Anonymous bidder') to match this field's pre-existing copy.
        bidderName: maskBidderUsername(b.bidder.username, 'Anonymous'),
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
  async cancelProxy(userId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
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
          bidCount: true,
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { maxAmount: true },
      });
      if (!latest || latest.maxAmount <= visible) {
        return { cancelled: false, alreadyCancelled: true, currentBid: visible };
      }

      // CAS the listing on the exact state we read BEFORE writing the cancel
      // row. Without this, an opposing bid committing between our read and our
      // write leaves a cancel row carrying maxAmount = the OLD visible bid —
      // BELOW the now-currentBid. The next duel then resolves off that stale
      // ceiling and can REGRESS currentBid backwards. Incrementing bidCount
      // also keeps the cancel row counted (history vs count drift). A zero-row
      // result means the auction moved — refuse rather than write a stale row.
      const claim = await tx.listing.updateMany({
        where: {
          id: listingId,
          status: 'ACTIVE',
          currentBid: visible,
          currentBidderId: buyer.id,
          // bidCount too (2026-11 audit L3): the bid path guards on it so ANY
          // interleaved write is detected. Without it, two concurrent cancels
          // (double-tap) both matched and each wrote a cancel row + bumped the
          // count, duplicating audit history for one action.
          bidCount: listing.bidCount,
        },
        data: { bidCount: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          'The auction moved while cancelling your proxy — please try again.',
        );
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
  async getMyBidForListing(userId: string, listingId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!buyer) return null;

    // Most recent bid by this user on this listing — its maxAmount is
    // their stored proxy ceiling. (Older bids' maxAmounts can be
    // ignored; each new bid overwrites the effective max.)
    const latest = await this.prisma.bid.findFirst({
      where: { listingId, bidderId: buyer.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  async placeBid(userId: string, listingId: string, dto: PlaceBidDto) {
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!buyer) throw new ForbiddenException('User not synced');
    // ⚠️ Closed is checked BEFORE banned: a member who closed their own
    // account and came back to a stale tab must not be told they were
    // suspended. See common/account-standing.ts.
    assertAccountNotClosed(buyer);
    if (buyer.isBanned) throw new ForbiddenException('Account suspended');
    if (buyer.auctionStrikes >= 3) {
      throw new ForbiddenException('Bidding suspended — three strikes for non-payment');
    }

    // Both contact points proven before a bid can commit us to a contract.
    await assertContactVerified(this.prisma, buyer.id, 'bid');

    // CONCURRENCY: the transaction alone is NOT enough. At Postgres's
    // default READ COMMITTED isolation, two simultaneous bids both read
    // the same listing snapshot and the last writer wins — the proxy
    // duel between them never happens and the wrong bidder can hold the
    // lead (worst exactly in the sniping window, when bids cluster).
    // The write inside is therefore a compare-and-swap on the snapshot
    // we resolved against; on conflict the whole attempt (including its
    // Bid rows) rolls back and we re-resolve from fresh state.
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await this.placeBidAttempt(buyer.id, listingId, dto);
        // Fire notifications only after the transaction has actually
        // committed (previously they were queued inside the tx and
        // could race a rollback).
        if (outcome.outbidUserId && outcome.outbidUserId !== buyer.id) {
          void this.notifyOutbid(
            outcome.outbidUserId,
            listingId,
            outcome.currentBid,
          );
        }
        void this.notifyBidPlaced(
          outcome.sellerId,
          listingId,
          outcome.currentBid,
        );
        // Inbox: the user just bid on this auction — clear any stale
        // "you've been outbid" rows for them on this listing.
        void this.notifications.resolveByEntity('listing', listingId, {
          userId: buyer.id,
        });
        this.activity.record({
          eventType: 'bid_placed',
          actor: { userId: buyer.id },
          listingId,
          amountCents: outcome.currentBid,
        });
        // A snipe extension moves endTime, which lives in the search document
        // (`endTimeTs`) and gates the one-shot "ending soon" alert. Neither
        // used to be refreshed after a bid, so `?q=` ordering could rank the
        // auction with a stale close time and a wishlister alerted before the
        // first extension could never be alerted again (2026-11 audit L4).
        if (outcome.extended) {
          void this.handleAuctionExtended(listingId, outcome.endTime);
        }
        return {
          currentBid: outcome.currentBid,
          bidCount: outcome.bidCount,
          reserveMet: outcome.reserveMet,
          endTime: outcome.endTime,
          youAreHighBidder: outcome.highBidderId === buyer.id,
        };
      } catch (err) {
        if (err instanceof BidConflictError && attempt < BID_RETRY_ATTEMPTS) {
          // Small jittered backoff so two colliding bidders don't
          // lock-step into the same window again.
          await new Promise((r) => setTimeout(r, 25 + Math.random() * 75));
          continue;
        }
        if (err instanceof BidConflictError) {
          throw new ConflictException(
            'Bidding is moving fast — your bid could not be placed. Please try again.',
          );
        }
        throw err;
      }
    }
  }

  // One transactional bid-resolution attempt. Throws BidConflictError
  // (rolling everything back) when the CAS detects the auction changed
  // underneath us.
  private async placeBidAttempt(
    buyerId: string,
    listingId: string,
    dto: PlaceBidDto,
  ) {
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
        },
      });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.listingType !== 'AUCTION') {
        throw new BadRequestException('Not an auction');
      }
      if (listing.status !== 'ACTIVE') {
        // A hidden/lapsed auction must not confirm its existence to a caller
        // who is not the owner (2026-11 audit L10). ACTIVE-but-ended keeps the
        // friendly 400 further down.
        if (
          listing.status === 'DRAFT' ||
          listing.status === 'PENDING_REVIEW' ||
          listing.status === 'CANCELLED'
        ) {
          throw new NotFoundException('Listing not found');
        }
        throw new BadRequestException('Auction is not active');
      }
      if (listing.sellerId === buyerId) {
        throw new ForbiddenException('Cannot bid on your own auction');
      }
      // A photo-less auction is not a real listing: the create path trusts a
      // client-declared imageCount, so a crafted create can publish before any
      // image exists, and photos cannot be added once a bid has locked the
      // listing (2026-11 audit L11). Refuse the bid instead of locking a
      // permanently photo-less auction.
      const listingPhotoCount = await tx.listingImage.count({
        where: { listingId },
      });
      if (listingPhotoCount === 0) {
        throw new BadRequestException(
          'This auction has no photos yet — bidding opens once the seller adds one.',
        );
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
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      const isSameBidder = listing.currentBidderId === buyerId;
      const currentBid = listing.currentBid ?? 0;
      const isOneShot = dto.isOneShot === true;

      // A bidder who is already leading must not be able to SILENTLY lower
      // their own stored proxy ceiling. The UI now pre-fills the raise at the
      // current max, but the API is the authority: lowering for real is the
      // explicit Cancel auto bid action (cancelProxy), which keeps the visible
      // lead instead of quietly reducing protection.
      if (isSameBidder && prevHighMax > 0 && dto.maxAmount < prevHighMax) {
        throw new BadRequestException({
          code: 'AUCTION_MAX_LOWERED',
          message:
            'Use Cancel auto bid to reduce your maximum — a new auto bid must be at least your current max.',
        });
      }

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
          newHighBidderId = buyerId;
          if (listing.currentBidderId && listing.currentBidderId !== buyerId) {
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
        newHighBidderId = buyerId;
        // Persist the raised maxAmount via a new Bid row so history is honest.
      } else if (dto.maxAmount > prevHighMax) {
        // New bidder beats stored max.
        const inc = bidIncrement(prevHighMax > 0 ? prevHighMax : startingBid);
        const proposed = (prevHighMax > 0 ? prevHighMax : startingBid - inc) + inc;
        visibleBid = Math.min(dto.maxAmount, proposed);
        // First bid scenario — visible bid is at least startingBid.
        if (visibleBid < startingBid) visibleBid = startingBid;
        newHighBidderId = buyerId;
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

      // Reserve semantics: the reserve is met when the HIGH BIDDER'S CEILING
      // clears it, not merely when the visible bid does. A lone proxy maximum
      // above the reserve must lift the visible bid to the reserve — the
      // alternative is an auction that expires unsold while the only bidder
      // was willing to pay more than the seller asked for (2026-11 audit H2).
      // The reserve amount becomes public at exactly this moment, which is
      // the normal proxy-auction behaviour ("reserve met" reveals the figure).
      const highMax = proxyCountered ? prevHighMax : dto.maxAmount;
      let reserveMet = listing.reserveMet;
      if (
        listing.reservePrice !== null &&
        !reserveMet &&
        highMax >= listing.reservePrice
      ) {
        visibleBid = Math.max(visibleBid, listing.reservePrice);
        reserveMet = true;
      }

      // Snipe protection — bid in last 2 mins pushes endTime out by 2 mins.
      const newEndTime =
        listing.endTime.getTime() - now.getTime() < SNIPE_WINDOW_MS
          ? new Date(now.getTime() + SNIPE_WINDOW_MS)
          : listing.endTime;


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
            bidderId: buyerId,
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
            bidderId: buyerId,
            amount: visibleBid,
            maxAmount: dto.maxAmount,
          },
        });
      } else {
        await tx.bid.create({
          data: {
            listingId,
            bidderId: buyerId,
            amount: visibleBid,
            maxAmount: dto.maxAmount,
          },
        });
      }

      // Update the listing snapshot — as a COMPARE-AND-SWAP on every
      // field the resolution above depended on. If a concurrent bid (or
      // the end sweep) changed any of them since our read, count === 0:
      // we throw, the transaction rolls back (including the Bid rows
      // created above), and the caller re-resolves from fresh state.
      // bidCount is in the guard on purpose — ANY interleaved bid bumps
      // it, so even a write that left currentBid coincidentally equal
      // is detected. status/endTime in the guard also make a bid lose
      // cleanly to a concurrent finalization instead of overwriting it.
      const dualRow = proxyCountered || proxyExhausted;
      const claim = await tx.listing.updateMany({
        where: {
          id: listingId,
          status: 'ACTIVE',
          endedAt: null,
          currentBid: listing.currentBid,
          currentBidderId: listing.currentBidderId,
          bidCount: listing.bidCount,
          endTime: listing.endTime,
        },
        data: {
          currentBid: visibleBid,
          currentBidderId: newHighBidderId,
          bidCount: { increment: dualRow ? 2 : 1 },
          reserveMet,
          endTime: newEndTime,
        },
      });
      if (claim.count === 0) {
        throw new BidConflictError();
      }

      // Outcome for the wrapper — notifications fire there, strictly
      // after this transaction commits.
      return {
        currentBid: visibleBid,
        bidCount: listing.bidCount + (dualRow ? 2 : 1),
        reserveMet,
        endTime: newEndTime,
        // Whether the snipe-protection window actually moved the close time.
        // The wrapper republishes the new close time to Meilisearch and re-arms
        // the one-shot "ending soon" alert when it did (2026-11 audit L4).
        extended: newEndTime.getTime() !== listing.endTime.getTime(),
        highBidderId: newHighBidderId,
        outbidUserId,
        sellerId: listing.sellerId,
      };
    });
  }

  // --- Buyer's own bids -------------------------------------------------

  async getMyBids(userId: string) {
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
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
            reservePrice: true, // only for hasReserve below — never exposed
            // Pay-by time on a won auction (finalizeAuction stamps
            // expiresAt = win + 24h; starting checkout CAS-nulls it). Needed
            // so /my/bids can show the deadline on a "Won — pay now" card
            // WITHOUT fetching each listing individually — that fallback fired
            // a phantom listing_view insights event per won row on every render.
            expiresAt: true,
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
        // Whether a reserve EXISTS — reserveMet alone can't distinguish
        // "no reserve" from "reserve not met" (both are false), and the
        // /my/bids "Reserve not met" chip must only show for the latter.
        // The reserve AMOUNT stays private.
        hasReserve: b.listing.reservePrice !== null,
        endTime: b.listing.endTime,
        endedAt: b.listing.endedAt,
        // Null once checkout starts (or when the listing isn't awaiting
        // payment), which is exactly when the deadline chip should disappear.
        payByAt:
          b.listing.status === 'PAYMENT_PENDING' ? b.listing.expiresAt : null,
        youAreHighBidder: b.listing.currentBidderId === buyer.id,
        isWinner: b.isWinner,
      }));

    return rows;
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

  private async finalizeAuction(
    listingId: string,
  ): Promise<AuctionFinalizeOutcome> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<AuctionFinalizeOutcome> => {
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
      if (!listing || listing.endedAt) return null; // already processed
      if (listing.status !== 'ACTIVE') return null;

      const now = new Date();

      // Every finalize write below is a COMPARE-AND-SWAP on the snapshot
      // we just read (bidCount/currentBidderId) plus a re-assertion that
      // endTime is STILL in the past at write time. A last-instant bid
      // that changed the leader — or extended endTime via snipe
      // protection — makes the claim fail; we simply skip and let the
      // next minute's sweep re-evaluate fresh state. Without this, the
      // sweep could crown a stale winner or end an auction that a snipe
      // bid had just legitimately extended.
      const casWhere = {
        id: listingId,
        status: 'ACTIVE' as const,
        endedAt: null,
        endTime: { lt: now },
        bidCount: listing.bidCount,
        currentBidderId: listing.currentBidderId,
      };

      // Defensive rescue for a winner whose stored ceiling clears the reserve
      // while the visible bid does not (legacy rows, or any path that predates
      // the ceiling-aware lift in placeBidAttempt). The sale settles AT THE
      // RESERVE — never below it — and the listing records the flag so the
      // public post-close state is consistent (2026-11 audit H2).
      let salePrice = listing.currentBid ?? 0;
      let finalReserveMet = listing.reserveMet;
      if (
        listing.bidCount > 0 &&
        listing.currentBidderId &&
        listing.reservePrice !== null &&
        !finalReserveMet
      ) {
        const topBid = await tx.bid.findFirst({
          where: { listingId, bidderId: listing.currentBidderId },
          orderBy: [{ maxAmount: 'desc' }, { id: 'desc' }],
          select: { maxAmount: true },
        });
        if (topBid && topBid.maxAmount >= listing.reservePrice) {
          finalReserveMet = true;
          salePrice = Math.max(salePrice, listing.reservePrice);
        }
      }

      // Case A: bids exist AND reserve met (or no reserve) → winner!
      if (
        listing.bidCount > 0 &&
        listing.currentBidderId &&
        (listing.reservePrice === null || finalReserveMet)
      ) {
        const claim = await tx.listing.updateMany({
          where: casWhere,
          data: {
            status: 'PAYMENT_PENDING',
            endedAt: now,
            // Buyer has 24h to pay — reuse expiresAt as the pay window
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            // The settled hammer: the visible bid, or the reserve when the
            // winner's ceiling cleared it (salePrice >= currentBid by design).
            currentBid: salePrice,
            reserveMet: finalReserveMet,
            // Fresh terminal state: nothing has been settled yet, and this
            // winner has not been struck. A crash between here and the
            // settlement is repaired by recoverAuctionSettlements().
            auctionSettledAt: null,
            winnerStruckAt: null,
          },
        });
        if (claim.count === 0) return null; // state moved — re-evaluate next sweep
        // Mark the winning bid
        const winningBid = await tx.bid.findFirst({
          where: { listingId, bidderId: listing.currentBidderId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (winningBid) {
          await tx.bid.update({
            where: { id: winningBid.id },
            data: { isWinner: true },
          });
        }
        // Outcome returned here; notifications fire after the transaction
        // commits (see below), never inside it.
        return {
          kind: 'WON' as const,
          sellerId: listing.sellerId,
          winnerId: listing.currentBidderId,
          amount: salePrice,
        };
      }

      // Case B: bids exist but reserve NOT met → seller decides
      if (listing.bidCount > 0 && !finalReserveMet) {
        const claim = await tx.listing.updateMany({
          where: casWhere,
          data: {
            status: 'EXPIRED',
            endedAt: now,
            auctionSettledAt: null,
            winnerStruckAt: null,
          },
        });
        if (claim.count === 0) return null; // state moved — re-evaluate next sweep
        // Notifications for this outcome fire after the transaction commits.
        return {
          kind: 'NO_RESERVE' as const,
          sellerId: listing.sellerId,
          amount: salePrice,
        };
      }

      // Case C: no bids
      const claim = await tx.listing.updateMany({
        where: casWhere,
        data: {
          status: 'EXPIRED',
          endedAt: now,
          auctionSettledAt: null,
          winnerStruckAt: null,
        },
      });
      if (claim.count === 0) return null; // state moved — re-evaluate next sweep
      return { kind: 'NO_BIDS' as const, sellerId: listing.sellerId, amount: 0 };
      },
    );

    if (!outcome) return null;

    // The listing index is normally maintained by ListingsService on a status
    // write. Finalization flips ACTIVE → PAYMENT_PENDING/EXPIRED right here,
    // so without this the Meili document keeps saying ACTIVE and a ?q= search
    // keeps returning an auction that ended days ago. Delete rather than
    // update: every terminal auction state is non-searchable.
    await this.removeFromSearchIndex(listingId);

    // Everything the settlement owes the people involved runs AFTER the
    // transaction has committed (announcing a winner whose write rolled back
    // would be worse than a delay), and only completes the job when
    // auctionSettledAt is stamped. A crash before that stamp leaves the row
    // for recoverAuctionSettlements() to replay — see the markers in
    // schema.prisma (2026-11 audit M4).
    await this.settleAuctionEnded(listingId);

    return outcome;
  }

  /**
   * Deliver the settlement for one ended auction and stamp auctionSettledAt.
   *
   * At-least-once by design: the terminal status flip commits first, so the
   * only way the notices/strike/runner-up invite survive a crash is for the
   * every-minute recovery sweep to be able to replay them. The strike itself
   * is exactly-once (winnerStruckAt CAS claim); duplicate notices are an
   * accepted, vanishingly rare trade-off.
   *
   * Derives the outcome from the row, so it is safe to call for a fresh
   * finalise AND for a replay.
   */
  async settleAuctionEnded(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        sellerId: true,
        status: true,
        endedAt: true,
        bidCount: true,
        currentBid: true,
        currentBidderId: true,
        reservePrice: true,
        reserveMet: true,
      },
    });
    if (!listing || !listing.endedAt) return;

    try {
      if (listing.status === 'PAYMENT_PENDING' && listing.currentBidderId) {
        // WON. If an ACCEPTED offer closed this auction early, the offer flow
        // has already told the buyer ("accepted — pay now") and the seller;
        // re-announcing a win would double-notify them. Only the losing
        // bidders are still owed a notice, so settle those and move on.
        const viaAcceptedOffer = await this.prisma.offer.findFirst({
          where: {
            listingId: listing.id,
            buyerId: listing.currentBidderId,
            status: { in: ['ACCEPTED', 'CONVERTED'] },
          },
          select: { id: true },
        });
        if (!viaAcceptedOffer) {
          await this.notifyAuctionWon(
            listing.currentBidderId,
            listing.id,
            listing.currentBid ?? 0,
          );
          await this.notifyAuctionEndedSeller(
            listing.sellerId,
            listing.id,
            'WON',
            listing.currentBid ?? 0,
          );
        }
        await this.resolveAndNotifyLosers(
          listing.id,
          listing.currentBidderId,
          listing.currentBid ?? 0,
        );
      } else if (listing.status === 'EXPIRED') {
        if (listing.bidCount === 0) {
          await this.notifyAuctionEndedSeller(
            listing.sellerId,
            listing.id,
            'NO_BIDS',
            0,
          );
        } else if (listing.reservePrice !== null && !listing.reserveMet) {
          await this.notifyAuctionEndedSeller(
            listing.sellerId,
            listing.id,
            'NO_RESERVE',
            listing.currentBid ?? 0,
          );
          await this.resolveAndNotifyLosers(
            listing.id,
            null,
            listing.currentBid ?? 0,
          );
        } else if (listing.currentBidderId) {
          // A winner who never paid: strike (exactly once), tell the seller
          // and the winner, and offer the item to the runner-up.
          await this.strikeUnpaidWinnerOnce(listing.id, listing.currentBidderId);
          await this.notifyWinnerLapsed(
            listing.currentBidderId,
            listing.id,
            listing.currentBid ?? 0,
          );
          await this.notifyAuctionEndedSeller(
            listing.sellerId,
            listing.id,
            'WINNER_UNPAID',
            listing.currentBid ?? 0,
          );
          await this.inviteRunnerUpOffer(listing.id, listing.currentBidderId);
        }
      } else {
        // SOLD/CANCELLED/other terminal states owe nothing here.
        await this.markAuctionSettled(listing.id);
        return;
      }
      await this.markAuctionSettled(listing.id);
    } catch (err) {
      // Leave auctionSettledAt NULL so the recovery sweep replays it.
      this.logger.warn(
        `settleAuctionEnded failed for ${listingId}: ${(err as Error).message}`,
      );
    }
  }

  private async markAuctionSettled(listingId: string): Promise<void> {
    await this.prisma.listing
      .updateMany({
        where: { id: listingId },
        data: { auctionSettledAt: new Date() },
      })
      .catch(() => undefined);
  }

  /**
   * Every-minute recovery for the two states a crash can leave behind
   * (2026-11 audit M4/M6):
   *
   *  1. a won auction whose checkout claim nulled expiresAt and then the
   *     process died before the Transaction row was written — no sweep can
   *     see it, so it is handed back to the lifecycle with a lapsed window;
   *  2. an ended auction (WON or EXPIRED) whose settlement never completed —
   *     replay settleAuctionEnded (at-least-once, strike exactly once).
   *
   * Everything is time-gated so a live checkout/settlement in progress is
   * never stepped on.
   */
  async recoverAuctionSettlements(): Promise<{
    unstuck: number;
    replayed: number;
  }> {
    const now = Date.now();
    let unstuck = 0;
    let replayed = 0;

    // (1) Stranded PAYMENT_PENDING: ended, pay window CAS-nulled by a
    // checkout start, no Transaction row at all, and old enough that the
    // insert cannot still be in flight. Hand it to sweepUnpaidWins by
    // stamping a lapsed window — never ACTIVE.
    try {
      const stranded = await this.prisma.listing.findMany({
        where: {
          listingType: 'AUCTION',
          status: 'PAYMENT_PENDING',
          endedAt: { not: null, lt: new Date(now - 60 * 60_000) },
          expiresAt: null,
          transactions: { none: {} },
        },
        select: { id: true },
        take: 25,
      });
      for (const l of stranded) {
        const claim = await this.prisma.listing.updateMany({
          where: {
            id: l.id,
            status: 'PAYMENT_PENDING',
            endedAt: { not: null },
            expiresAt: null,
            transactions: { none: {} },
          },
          data: { expiresAt: new Date(now - 1000) },
        });
        if (claim.count > 0) unstuck += 1;
      }
    } catch (err) {
      this.logger.warn(
        `recoverAuctionSettlements stranded scan failed: ${(err as Error).message}`,
      );
    }

    // (2) Ended auctions whose settlement never completed.
    try {
      const unsettled = await this.prisma.listing.findMany({
        where: {
          listingType: 'AUCTION',
          status: { in: ['PAYMENT_PENDING', 'EXPIRED'] },
          endedAt: { not: null, lt: new Date(now - 2 * 60_000) },
          auctionSettledAt: null,
        },
        select: { id: true },
        orderBy: { endedAt: 'asc' },
        take: 50,
      });
      for (const l of unsettled) {
        await this.settleAuctionEnded(l.id);
        replayed += 1;
      }
    } catch (err) {
      this.logger.warn(
        `recoverAuctionSettlements replay failed: ${(err as Error).message}`,
      );
    }

    return { unstuck, replayed };
  }

  // Best-effort eviction. The auction is already committed as ended, so a
  // search-index failure (Meili down) must be logged, not thrown — the
  // hydration gate in ListingsService.browseViaSearch is the second line of
  // defence, and the unpaid-win sweep retries the delete once more.
  /**
   * Fan out a cancelled auction to the people it stranded (2026-11 audit H4 /
   * M12). Sellers can no longer cancel a bid-bearing auction, so this is used
   * by the admin take-down path and any future platform-side cancellation:
   * resolve every open auction inbox row on the listing, expire an accepted
   * offer, and tell each bidder — the winner included — that no sale was made
   * and nothing is owed. Best-effort; the status change is the source of
   * truth.
   */
  async announceAuctionCancelled(listingId: string): Promise<void> {
    try {
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { id: true, title: true, currentBidderId: true, sellerId: true },
      });
      if (!listing) return;
      await this.notifications.resolveByEntity('listing', listingId, {
        resolvedBy: 'auto_expired',
      });
      await this.prisma.offer
        .updateMany({
          where: { listingId, status: 'ACCEPTED' },
          data: { status: 'EXPIRED' },
        })
        .catch(() => undefined);
      const bidders = await this.prisma.bid.findMany({
        where: { listingId },
        distinct: ['bidderId'],
        select: {
          bidderId: true,
          bidder: { select: { email: true, phone: true } },
        },
      });
      for (const b of bidders) {
        if (!b.bidder?.email) continue;
        if (listing.currentBidderId === b.bidderId) {
          await this.notifications.auctionCancelledForWinner(
            b.bidder.email,
            listing.title,
            listing.id,
            b.bidder.phone,
          );
        } else {
          await this.notifications.auctionCancelledForBidder(
            b.bidder.email,
            listing.title,
            listing.id,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `announceAuctionCancelled failed for ${listingId}: ${(err as Error).message}`,
      );
    }
  }

  // Best-effort: republish an extended close time to the listings index and
  // re-arm the one-shot ending-soon alert. Both are derived caches — the
  // database is the truth — so a failure must never fail the bid.
  private async handleAuctionExtended(
    listingId: string,
    endTime: Date,
  ): Promise<void> {
    try {
      await this.search.updateDocuments(INDEXES.LISTINGS, [
        { id: listingId, endTimeTs: endTime.getTime() },
      ]);
    } catch (err) {
      this.logger.warn(
        `Failed to republish extended endTime for ${listingId}: ${(err as Error).message}`,
      );
    }
    await this.prisma.listing
      .updateMany({
        where: { id: listingId },
        data: { endingSoonNotifiedAt: null },
      })
      .catch(() => undefined);
  }

  private async removeFromSearchIndex(listingId: string): Promise<void> {
    try {
      await this.search.deleteDocument(INDEXES.LISTINGS, listingId);
    } catch (err) {
      this.logger.warn(
        `Failed to remove auction ${listingId} from search index: ${(err as Error).message}`,
      );
    }
  }

  // M30 — resolve losing bidders' stuck bid_outbid rows on an ended auction
  // and send each distinct loser a one-shot 'you didn't win' notice. The
  // type filter is REQUIRED — an unscoped resolve in the WON case would
  // clear the winner's freshly-persisted auction_won row (same
  // linkedType/linkedId). winnerUserId (nullable — null in reserve-not-met
  // closes) is additionally excluded so a winner never gets a loser notice.
  private async resolveAndNotifyLosers(
    listingId: string,
    winnerUserId: string | null,
    finalBid: number,
  ) {
    try {
      await this.notifications.resolveByEntity('listing', listingId, {
        resolvedBy: 'auto_expired',
        types: ['bid_outbid'],
        ...(winnerUserId ? { excludeUserId: winnerUserId } : {}),
      });
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true },
      });
      if (!listing) return;
      const bidders = await this.prisma.bid.findMany({
        where: {
          listingId,
          ...(winnerUserId ? { bidderId: { not: winnerUserId } } : {}),
        },
        distinct: ['bidderId'],
        select: { bidder: { select: { email: true } } },
      });
      for (const b of bidders) {
        if (!b.bidder?.email) continue;
        void this.notifications.auctionEndedLoser(
          b.bidder.email,
          listing.title,
          finalBid,
          listingId,
        );
      }
    } catch (err) {
      this.logger.warn(
        `resolveAndNotifyLosers failed for ${listingId}: ${(err as Error).message}`,
      );
    }
  }

  // P0.2 — sweep won auctions whose winner never STARTED checkout inside
  // the 24h pay window. finalizeAuction leaves the listing PAYMENT_PENDING
  // with expiresAt = pay-by time; starting checkout CAS-nulls expiresAt
  // (see TransactionsService.reserveAndCreateLine), after which the manual
  // freeze sweep owns the lifecycle via the transaction's own window. So a
  // row still carrying a LAPSED expiresAt here means no checkout ever
  // began → flip to EXPIRED (terminal; seller can relist) + tell the
  // seller. The status+expiresAt guard makes this race-safe against a
  // winner claiming checkout concurrently.
  async sweepUnpaidWins(): Promise<{ expired: number }> {
    const now = new Date();
    const stale = await this.prisma.listing.findMany({
      where: {
        listingType: 'AUCTION',
        status: 'PAYMENT_PENDING',
        endedAt: { not: null },
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, sellerId: true, currentBid: true, currentBidderId: true },
      take: 50,
    });
    let expired = 0;
    for (const l of stale) {
      const claim = await this.prisma.listing.updateMany({
        where: {
          id: l.id,
          status: 'PAYMENT_PENDING',
          expiresAt: { not: null, lt: now },
        },
        data: {
          status: 'EXPIRED',
          // A new terminal state: the WON settlement markers no longer
          // describe this row, so clear them. The settlement below re-stamps
          // auctionSettledAt; a crash before it is repaired by the recovery
          // sweep. winnerStruckAt null makes THIS lapse strikeable even
          // though the WON phase was already settled.
          auctionSettledAt: null,
          winnerStruckAt: null,
        },
      });
      if (claim.count === 0) continue; // winner claimed checkout in the gap
      expired += 1;
      // Defensive: finalize already evicted the doc, but a Meili outage then
      // (or a legacy row from before this sweep) must not leave it searchable.
      await this.removeFromSearchIndex(l.id);
      // An accepted AUCTION offer is promoted to the winner state and shares
      // this 24h window. Expire the offer alongside the listing so /my/offers
      // never shows a live "pay now" link for a sale that has lapsed (the
      // offer expiry sweep deliberately leaves auction offers to this sweep).
      await this.prisma.offer
        .updateMany({
          where: { listingId: l.id, status: 'ACCEPTED' },
          data: { status: 'EXPIRED' },
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to expire accepted offer for auction ${l.id}: ${(err as Error).message}`,
          ),
        );
      this.logger.log(`Auction ${l.id}: winner never paid within 24h → EXPIRED`);
      // Strike the winner (exactly once), notify winner + seller, offer the
      // item to the runner-up, and stamp the settlement. A failure leaves the
      // marker null so recoverAuctionSettlements() replays it.
      await this.settleAuctionEnded(l.id);
    }
    return { expired };
  }

  // Ask the seller whether to offer an expired-win auction to the runner-up.
  // Best-effort tail work on the sweep: a failure here must never affect the
  // EXPIRED flip that already committed.
  private async inviteRunnerUpOffer(
    listingId: string,
    unpaidWinnerId: string | null,
  ) {
    try {
      const runnerUp = await this.findRunnerUp(listingId, unpaidWinnerId);
      if (!runnerUp) return;
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          title: true,
          status: true,
          sellerId: true,
          seller: { select: { email: true, firstName: true, phone: true } },
        },
      });
      // Only while the listing is still sitting EXPIRED — if the seller has
      // already relisted or cancelled it in the gap, stay quiet.
      if (!listing || listing.status !== 'EXPIRED') return;

      // The seller's decision window. Deliberately short: the runner-up's
      // interest is perishable and the bid amount is only meaningful while
      // the auction is fresh in their mind.
      const expiresAt = new Date(
        Date.now() + RUNNER_UP_DECISION_HOURS * 3600_000,
      );
      const token = await this.actionTokens
        .mint({
          purpose: 'AUCTION_RUNNER_UP',
          targetType: 'listing',
          targetId: listing.id,
          authorisedUserId: listing.sellerId,
          expiresAt,
          metadata: {
            runnerUpBidderId: runnerUp.bidderId,
            runnerUpAmount: runnerUp.amount,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `AUCTION_RUNNER_UP token mint failed: ${(err as Error).message}`,
          );
          return null;
        });

      await this.notifications.auctionRunnerUpAvailable({
        sellerEmail: listing.seller.email,
        sellerName: listing.seller.firstName ?? 'Seller',
        sellerPhone: listing.seller.phone,
        listingTitle: listing.title,
        listingId: listing.id,
        amount: runnerUp.amount,
        bidderName: runnerUp.username ?? 'the next bidder',
        hoursToDecide: RUNNER_UP_DECISION_HOURS,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.warn(`runner-up invite failed: ${(err as Error).message}`);
    }
  }

  // Highest bid from someone OTHER than the defaulting winner. Distinct by
  // bidder (a proxy war leaves many rows per person) and taking the highest
  // per bidder, so "runner-up" means the second-highest PERSON, not the
  // winner's own second-highest bid.
  private async findRunnerUp(
    listingId: string,
    excludeBidderId: string | null,
  ): Promise<{ bidderId: string; amount: number; username: string | null } | null> {
    const bids = await this.prisma.bid.findMany({
      where: {
        listingId,
        ...(excludeBidderId ? { bidderId: { not: excludeBidderId } } : {}),
      },
      orderBy: { amount: 'desc' },
      select: {
        bidderId: true,
        amount: true,
        bidder: {
          select: {
            username: true,
            isBanned: true,
            accountClosedAt: true,
            auctionStrikes: true,
          },
        },
      },
      take: 25,
    });
    for (const b of bids) {
      // Never hand a second chance to a banned account, or to a bidder the
      // strike system has already suspended — the place-bid gate refuses them
      // at 3 strikes, so promoting them would create an unpayable sale.
      // ⚠️ A CLOSED account is skipped for a different reason: closure
      // releases their phone and email back into the namespace and deletes
      // their ActionTokens, so the win SMS has nowhere to go and the checkout
      // link cannot be opened. Promoting one strands the seller's auction in
      // PAYMENT_PENDING for 24h waiting on someone who no longer exists.
      if (b.bidder?.isBanned || isAccountClosed(b.bidder)) continue;
      if ((b.bidder?.auctionStrikes ?? 0) >= 3) continue;
      return {
        bidderId: b.bidderId,
        amount: b.amount,
        username: b.bidder?.username ?? null,
      };
    }
    return null;
  }

  /**
   * Seller accepts: offer the expired auction to the runner-up at their own
   * highest bid. CAS EXPIRED→PAYMENT_PENDING carrying the runner-up as the
   * winner with a fresh 24h pay window, then reuse the exact auction-win
   * notification machinery (CHECKOUT token + email/SMS). sweepUnpaidWins then
   * polices this second window for free — including the strike if they too
   * fail to pay — because the row is indistinguishable from a normal win.
   */
  async offerToRunnerUp(
    listingId: string,
    sellerId: string,
    runnerUpBidderId: string,
    amount: number,
  ): Promise<{ offered: boolean; reason?: string }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing) return { offered: false, reason: 'Listing no longer exists' };
    if (listing.sellerId !== sellerId) {
      return { offered: false, reason: 'Not your listing' };
    }
    if (listing.status !== 'EXPIRED') {
      // Seller relisted / cancelled / it sold another way in the meantime.
      return {
        offered: false,
        reason: 'This auction is no longer waiting — nothing was changed',
      };
    }
    // Re-check the bidder is still eligible at accept time, not just when the
    // SMS was sent (they could have been banned, closed their account, or
    // struck out since).
    const bidder = await this.prisma.user.findUnique({
      where: { id: runnerUpBidderId },
      select: {
        id: true,
        isBanned: true,
        accountClosedAt: true,
        auctionStrikes: true,
      },
    });
    if (
      !bidder ||
      bidder.isBanned ||
      isAccountClosed(bidder) ||
      bidder.auctionStrikes >= 3
    ) {
      return {
        offered: false,
        reason: 'That bidder can no longer be offered the item',
      };
    }

    const now = new Date();
    const promoted = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.listing.updateMany({
        // CAS on EXPIRED: two taps of the same SMS link, or a relist racing the
        // accept, can only ever produce ONE promotion.
        where: { id: listingId, status: 'EXPIRED' },
        data: {
          status: 'PAYMENT_PENDING',
          currentBidderId: runnerUpBidderId,
          currentBid: amount,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          // Fresh window ⇒ fresh reminder eligibility (the pay-window nudge
          // guard is one-shot per stamp).
          winnerRemindedAt: null,
          // A new sale window means a new settlement: clear the previous
          // winner's settlement markers so this promotion (and its eventual
          // lapse) is settled and struck on its own merits.
          auctionSettledAt: null,
          winnerStruckAt: null,
        },
      });
      if (claim.count === 0) return false;
      // Move the isWinner flag with the promotion. Without this the DEFAULTED
      // winner kept Bid.isWinner=true (so /my/bids still showed them "You won —
      // pay now", which then 403s), and the actual buyer got no won card at
      // all. Clear every flag on this listing, then flag the runner-up's
      // highest bid — same transaction as the listing flip, so the two can
      // never diverge.
      await tx.bid.updateMany({
        where: { listingId, isWinner: true },
        data: { isWinner: false },
      });
      const winningBid = await tx.bid.findFirst({
        where: { listingId, bidderId: runnerUpBidderId },
        orderBy: [{ amount: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (winningBid) {
        await tx.bid.update({
          where: { id: winningBid.id },
          data: { isWinner: true },
        });
      }
      return true;
    });
    if (!promoted) {
      return { offered: false, reason: 'This auction has already moved on' };
    }

    this.logger.log(
      `Auction ${listingId}: offered to runner-up ${runnerUpBidderId} at ${amount}c`,
    );
    // Same machinery as a first-place win — the buyer gets the identical
    // "you won, pay within 24h" flow with a CHECKOUT deep link.
    void this.notifyAuctionWon(runnerUpBidderId, listingId, amount);
    // The seller just acted on the "offer it to the next bidder?" task — clear
    // it (and, harmlessly, the other listing-linked rows for this listing).
    void this.notifications.resolveByEntity('listing', listingId);
    return { offered: true };
  }

  // Nudge an auction winner ~6h before the 24h pay window lapses (→ EXPIRED
  // + strike). The population is exactly the sweepUnpaidWins query, one
  // window earlier: PAYMENT_PENDING with expiresAt still set (a started
  // checkout CAS-nulls it) means no payment began. Guard on winnerRemindedAt
  // (CAS-claimed) so the every-minute cron sends exactly once. Mint a fresh
  // CHECKOUT token expiring at the pay-by time so the SMS deep-links to
  // checkout like the original 'you won' notification.
  async remindUnpaidWinners(): Promise<{ reminded: number }> {
    const now = new Date();
    const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const due = await this.prisma.listing.findMany({
      where: {
        listingType: 'AUCTION',
        status: 'PAYMENT_PENDING',
        endedAt: { not: null },
        winnerRemindedAt: null,
        expiresAt: { not: null, gt: now, lte: soon },
      },
      select: { id: true, currentBidderId: true, currentBid: true },
      take: 50,
    });
    let reminded = 0;
    for (const l of due) {
      if (!l.currentBidderId) continue;
      // CAS-claim: only the run that flips null→now sends.
      const claim = await this.prisma.listing.updateMany({
        where: {
          id: l.id,
          status: 'PAYMENT_PENDING',
          winnerRemindedAt: null,
          expiresAt: { not: null, gt: now },
        },
        data: { winnerRemindedAt: now },
      });
      if (claim.count === 0) continue;
      reminded += 1;
      void this.notifyWinnerPayReminder(
        l.currentBidderId,
        l.id,
        l.currentBid ?? 0,
      );
    }
    return { reminded };
  }

  // FLOW-F5 (M28) — record an unpaid-auction-win strike against the winner
  // and alert an admin once they hit the 3-strike suspension threshold the
  // place-bid gate enforces.
  //
  // Exactly-once (2026-11 audit M4): the settlement can be replayed by the
  // recovery sweep, so the strike is claimed by CAS on the listing's
  // winnerStruckAt marker BEFORE the counter is incremented. A replay after a
  // crash either re-claims nothing (already struck) or strikes once.
  private async strikeUnpaidWinnerOnce(bidderId: string, listingId: string) {
    try {
      const claim = await this.prisma.listing.updateMany({
        where: { id: listingId, winnerStruckAt: null },
        data: { winnerStruckAt: new Date() },
      });
      if (claim.count === 0) return; // already struck
      const after = await this.prisma.user.update({
        where: { id: bidderId },
        data: { auctionStrikes: { increment: 1 }, lastStrikeAt: new Date() },
        select: { auctionStrikes: true, username: true },
      });
      if (after.auctionStrikes >= 3) {
        await this.prisma.adminAlert
          .create({
            data: {
              type: 'BIDDER_AUCTION_STRIKES_THRESHOLD',
              referenceId: bidderId,
              urgent: true,
              context: `Bidder @${after.username ?? bidderId} hit ${after.auctionStrikes} non-payment strikes (latest: auction ${listingId}). Bidding and offers are suspended automatically — review the strikes in the user's dossier and clear them if this was not the buyer's fault.`,
            },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      // Put the claim back ONLY when the counter write failed before it could
      // land — anything else risks a double strike. A failed settlement is
      // replayed by the recovery sweep thanks to auctionSettledAt staying null.
      await this.prisma.listing
        .updateMany({
          where: { id: listingId, winnerStruckAt: { not: null } },
          data: { winnerStruckAt: null },
        })
        .catch(() => undefined);
      this.logger.warn(
        `strikeUnpaidWinnerOnce failed for ${bidderId}/${listingId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  // M31 — resolve the lapsed winner's auction_won inbox row (dismissible:
  // false, so only a server-side resolve can clear it) and send a one-shot
  // 'payment window missed — sale cancelled' notice. Best-effort.
  private async notifyWinnerLapsed(
    winnerId: string,
    listingId: string,
    finalBid: number,
  ) {
    try {
      await this.notifications.resolveByEntity('listing', listingId, {
        userId: winnerId,
        resolvedBy: 'auto_expired',
        types: ['auction_won'],
      });
      const [winner, listing] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: winnerId } }),
        this.prisma.listing.findUnique({
          where: { id: listingId },
          select: { title: true },
        }),
      ]);
      if (!winner?.email || !listing) return;
      void this.notifications.auctionWinnerLapsed(
        winner.email,
        listing.title,
        finalBid,
        winner.phone,
        listingId,
      );
    } catch (err) {
      this.logger.warn(
        `notifyWinnerLapsed failed for ${winnerId}/${listingId}: ${(err as Error).message}`,
      );
    }
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
        token ? `${APP_URL()}/a/${token}` : undefined,
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
        token ? `${APP_URL()}/a/${token}` : undefined,
      );
    } catch (err) {
      this.logger.warn(`auctionWon notify failed: ${(err as Error).message}`);
    }
  }

  // ~6h-to-lapse pay reminder to an auction winner. Mints a FRESH CHECKOUT
  // token (the original 24h one is near-expiry) whose TTL matches the
  // remaining pay window so the SMS deep-link stays valid to the deadline.
  private async notifyWinnerPayReminder(
    userId: string,
    listingId: string,
    amount: number,
  ) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
      });
      if (!user || !listing) return;
      const payBy = listing.expiresAt ?? new Date(Date.now() + 6 * 3600_000);
      const hoursLeft = Math.max(
        1,
        Math.round((payBy.getTime() - Date.now()) / 3_600_000),
      );
      const token = await this.actionTokens
        .mint({
          purpose: 'CHECKOUT',
          targetType: 'listing',
          targetId: listing.id,
          authorisedUserId: userId,
          expiresAt: payBy,
          metadata: { auctionWinAmount: amount },
        })
        .catch(() => null);
      await this.notifications.auctionPayReminderWinner({
        buyerEmail: user.email,
        buyerName: user.firstName ?? 'Bidder',
        buyerPhone: user.phone,
        listingTitle: listing.title,
        listingId: listing.id,
        amount,
        hoursLeft,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.warn(`winner pay-reminder failed: ${(err as Error).message}`);
    }
  }

  private async notifyAuctionEndedSeller(
    sellerId: string,
    listingId: string,
    outcome: 'WON' | 'NO_RESERVE' | 'NO_BIDS' | 'WINNER_UNPAID',
    amount: number,
  ) {
    try {
      const seller = await this.prisma.user.findUnique({ where: { id: sellerId } });
      const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
      if (!seller || !listing) return;
      await this.notifications.auctionEndedForSeller(
        seller.email,
        listing.title,
        outcome,
        amount,
        listingId,
        seller.phone,
      );
    } catch (err) {
      this.logger.warn(`auctionEnded notify failed: ${(err as Error).message}`);
    }
  }
}
