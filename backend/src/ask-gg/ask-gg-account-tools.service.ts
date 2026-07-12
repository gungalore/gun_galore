import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsService } from '../payments/transactions.service';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
import { RafflesService } from '../raffles/raffles.service';
import { SwapFundingService } from '../swaps/swap-funding.service';
import { SwapProposalsService } from '../swaps/swap-proposals.service';
import { SellerToolsService } from '../users/seller-tools.service';

/**
 * Ask GG Everywhere (W5 / B3) — the 8 read-only account tools.
 *
 * THE PRIVACY CONTRACT (enforced by the wave-5 PII gate spec):
 *  - Zero user-identifier inputs. Every method takes the AUTHENTICATED
 *    caller (`account`) resolved server-side from the Clerk session in
 *    preflight — the model cannot name a user, ever.
 *  - Whitelist-by-construction shapers. The wrapped services may return
 *    rich rows (delivery addresses, carrier PINs, party emails on some
 *    paths); NOTHING reaches the tool_result except the fields lifted
 *    explicitly here. Forbidden forever: bank numbers (including Gun
 *    Galore's own EFT account), carrierDropoffPin, addresses, emails,
 *    phones, ID/licence numbers, real names. Counterparties are
 *    USERNAMES ONLY. Free text is clipped.
 *  - Every answer carries an internal `href` so the assistant deep-links
 *    the user to the real page (which is where sensitive details like
 *    banking references legitimately live).
 *  - Read-only: no method here writes anything.
 *
 * Money: cents → WHOLE RAND (rounded) for model readability.
 * Dates: ISO day precision.
 */

export interface AskGgAccount {
  clerkId: string;
  userId: string;
}

const clip = (s: string | null | undefined, max = 80): string =>
  !s ? '' : s.length > max ? `${s.slice(0, max - 1)}…` : s;

const rand = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents / 100);

const day = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

// Local minimal views of the wrapped services' rich returns — only the
// fields the shapers lift. Anything else on the runtime object is dead
// to us by construction.
interface TxRowView {
  id: string;
  quantity: number;
  listingPrice: number;
  buyerTotal: number;
  sellerPayout: number;
  paymentStatus: string;
  shippingStatus: string | null;
  trackingReference: string | null;
  paidAt: Date | null;
  acceptedAt: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  releasedAt: Date | null;
  listing: { title: string; isFirearm: boolean } | null;
  buyer: { username: string | null } | null;
  seller: { username: string | null } | null;
}

@Injectable()
export class AskGgAccountToolsService {
  private readonly logger = new Logger(AskGgAccountToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly transactions: TransactionsService,
    private readonly offers: OffersService,
    private readonly auctions: AuctionsService,
    private readonly raffles: RafflesService,
    private readonly swapFunding: SwapFundingService,
    private readonly swapProposals: SwapProposalsService,
    private readonly sellerTools: SellerToolsService,
  ) {}

  /** 1. What needs my attention right now? (shared aggregation with the
   *  site's urgent-notifications strip). */
  async getMyAccountOverview(account: AskGgAccount) {
    const { notifications } = await this.users.getUrgentSummary(
      account.clerkId,
    );
    return {
      needsAttention: notifications, // already {id,label,href,severity} — no PII by construction
      note:
        notifications.length === 0
          ? 'Nothing urgent on the account right now.'
          : 'These are live action items — link the user to each href.',
      href: '/dashboard',
    };
  }

  /** 2. Recent purchases (buyer side). */
  async getMyPurchases(account: AskGgAccount, limit = 8) {
    const rows = (await this.transactions.findForUser(
      account.clerkId,
      'buyer',
    )) as unknown as TxRowView[];
    return {
      purchases: rows.slice(0, Math.min(Math.max(limit, 1), 10)).map((t) => ({
        id: t.id,
        title: clip(t.listing?.title),
        quantity: t.quantity,
        totalRand: rand(t.buyerTotal),
        paymentStatus: t.paymentStatus,
        shippingStatus: t.shippingStatus ?? null,
        isFirearm: t.listing?.isFirearm ?? false,
        sellerUsername: t.seller?.username ?? null,
        paidAt: day(t.paidAt),
        dispatchedAt: day(t.dispatchedAt),
        deliveredAt: day(t.deliveredAt),
        trackingReference: t.trackingReference ?? null,
        href: `/transactions/${t.id}`,
      })),
      totalOnAccount: rows.length,
      href: '/my/orders',
    };
  }

  /** 3. Recent sales (seller side). NEVER lifts carrierDropoffPin —
   *  the PIN lives on the transaction page only. */
  async getMySales(account: AskGgAccount, limit = 8) {
    const rows = (await this.transactions.findForUser(
      account.clerkId,
      'seller',
    )) as unknown as TxRowView[];
    return {
      sales: rows.slice(0, Math.min(Math.max(limit, 1), 10)).map((t) => ({
        id: t.id,
        title: clip(t.listing?.title),
        quantity: t.quantity,
        saleRand: rand(t.listingPrice),
        yourPayoutRand: rand(t.sellerPayout),
        paymentStatus: t.paymentStatus,
        shippingStatus: t.shippingStatus ?? null,
        isFirearm: t.listing?.isFirearm ?? false,
        buyerUsername: t.buyer?.username ?? null,
        paidAt: day(t.paidAt),
        dispatchedAt: day(t.dispatchedAt),
        deliveredAt: day(t.deliveredAt),
        payoutReleasedAt: day(t.releasedAt),
        trackingReference: t.trackingReference ?? null,
        href: `/transactions/${t.id}`,
      })),
      totalOnAccount: rows.length,
      href: '/my/sales',
    };
  }

  /** 4. One order/transaction by id or order reference — OWN lean
   *  select (deliberately NOT TransactionsService.findById, which can
   *  expose party contact details on collection flows). Uniform
   *  "not found on your account" whether the id is wrong OR belongs to
   *  someone else. */
  async getOrderStatus(account: AskGgAccount, reference: string) {
    const ref = (reference ?? '').trim();
    if (!ref || ref.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(ref)) {
      return { found: false, note: 'Not found on your account.' };
    }

    // Try transaction id first.
    const t = await this.prisma.transaction.findUnique({
      where: { id: ref },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        quantity: true,
        listingPrice: true,
        buyerTotal: true,
        paymentStatus: true,
        shippingStatus: true,
        shippingMethod: true,
        trackingReference: true,
        paidAt: true,
        acceptedAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        releasedAt: true,
        listing: { select: { title: true, isFirearm: true } },
      },
    });
    if (t && (t.buyerId === account.userId || t.sellerId === account.userId)) {
      const role = t.buyerId === account.userId ? 'buyer' : 'seller';
      return {
        found: true,
        type: 'transaction',
        role,
        title: clip(t.listing?.title),
        quantity: t.quantity,
        amountRand: rand(role === 'buyer' ? t.buyerTotal : t.listingPrice),
        paymentStatus: t.paymentStatus,
        shippingStatus: t.shippingStatus ?? null,
        shippingMethod: t.shippingMethod ?? null,
        trackingReference: t.trackingReference ?? null,
        isFirearm: t.listing?.isFirearm ?? false,
        timeline: {
          paid: day(t.paidAt),
          sellerAccepted: day(t.acceptedAt),
          dispatched: day(t.dispatchedAt),
          delivered: day(t.deliveredAt),
          payoutReleased: day(t.releasedAt),
        },
        nextAction: nextActionFor(t, role),
        href: `/transactions/${t.id}`,
      };
    }

    // Then order id / order reference (buyer-owned).
    const o = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: ref }, { orderReference: ref }],
        buyerId: account.userId,
      },
      select: {
        id: true,
        status: true,
        orderReference: true,
        buyerTotal: true,
        createdAt: true,
        transactions: {
          select: {
            id: true,
            paymentStatus: true,
            shippingStatus: true,
            listing: { select: { title: true } },
          },
        },
      },
    });
    if (o) {
      return {
        found: true,
        type: 'order',
        orderReference: o.orderReference ?? null,
        status: o.status,
        placedAt: day(o.createdAt),
        totalRand: rand(o.buyerTotal),
        items: o.transactions.map((tx) => ({
          id: tx.id,
          title: clip(tx.listing?.title),
          paymentStatus: tx.paymentStatus,
          shippingStatus: tx.shippingStatus ?? null,
          href: `/transactions/${tx.id}`,
        })),
        href: `/orders/${o.id}`,
      };
    }

    return { found: false, note: 'Not found on your account.' };
  }

  /** 5. Open offers (made + received) and auction bids. Offer NOTES are
   *  deliberately not lifted (counterparty free text). */
  async getMyOffersAndBids(account: AskGgAccount) {
    const [made, received, bids] = await Promise.all([
      this.offers.getMyOffers(account.clerkId),
      this.offers.getReceivedOffers(account.clerkId),
      this.auctions.getMyBids(account.clerkId),
    ]);
    type OfferView = {
      id: string;
      status: string;
      offerAmount: number;
      counterAmount: number | null;
      expiresAt: Date | null;
      listing: { title: string; seller?: { username: string | null } } | null;
      buyer?: { username: string | null } | null;
    };
    type BidView = {
      listingId: string;
      listingTitle: string;
      listingStatus: string;
      myMaxAmount: number | null;
      myLastBidAmount: number | null;
      currentBid: number | null;
      youAreHighBidder: boolean;
      isWinner: boolean;
      endTime: Date | null;
    };
    return {
      offersMade: (made as unknown as OfferView[]).slice(0, 10).map((of) => ({
        id: of.id,
        title: clip(of.listing?.title),
        sellerUsername: of.listing?.seller?.username ?? null,
        offerRand: rand(of.offerAmount),
        counterRand: rand(of.counterAmount),
        status: of.status,
        expires: day(of.expiresAt),
        href: '/my/offers',
      })),
      offersReceived: (received as unknown as OfferView[])
        .slice(0, 10)
        .map((of) => ({
          id: of.id,
          title: clip(of.listing?.title),
          buyerUsername: of.buyer?.username ?? null,
          offerRand: rand(of.offerAmount),
          counterRand: rand(of.counterAmount),
          status: of.status,
          expires: day(of.expiresAt),
          href: '/my/offers',
        })),
      auctionBids: (bids as unknown as BidView[]).slice(0, 10).map((b) => ({
        title: clip(b.listingTitle),
        listingStatus: b.listingStatus,
        myMaxRand: rand(b.myMaxAmount),
        myLastBidRand: rand(b.myLastBidAmount),
        currentBidRand: rand(b.currentBid),
        youAreHighBidder: b.youAreHighBidder,
        won: b.isWinner,
        ends: day(b.endTime),
        href: `/listings/${b.listingId}`,
      })),
      href: '/my/offers',
    };
  }

  /** 6. Raffle / competition entries + wins. NEVER lifts
   *  winnerLicenceRef or any claim paperwork fields. */
  async getMyRaffleEntries(account: AskGgAccount) {
    type TicketView = {
      ticketNumber: number | string | null;
      status: string;
      amountCents: number | null;
      paidAt: Date | null;
      raffle: {
        id: string;
        title: string;
        status: string;
        drawAt: Date | null;
      } | null;
    };
    type WinView = {
      createdAt?: Date | null;
      raffle: {
        title: string;
        prizeIsFirearm?: boolean;
        // drawnAt lives on the RAFFLE (selected by getMyWins) — the
        // RaffleWinner row itself has no drawnAt column.
        drawnAt?: Date | null;
      } | null;
    };
    const [tickets, wins] = await Promise.all([
      this.raffles.getMyTickets(account.clerkId),
      this.raffles.getMyWins(account.clerkId),
    ]);
    return {
      tickets: (tickets as unknown as TicketView[]).slice(0, 12).map((tk) => ({
        raffleTitle: clip(tk.raffle?.title),
        ticketNumber: tk.ticketNumber ?? null,
        status: tk.status,
        amountRand: rand(tk.amountCents),
        paidAt: day(tk.paidAt),
        raffleStatus: tk.raffle?.status ?? null,
        drawAt: day(tk.raffle?.drawAt),
        href: tk.raffle ? `/competitions/${tk.raffle.id}` : '/competitions',
      })),
      wins: (wins as unknown as WinView[]).slice(0, 5).map((w) => ({
        raffleTitle: clip(w.raffle?.title),
        wonAt: day(w.raffle?.drawnAt ?? w.createdAt),
        prizeIsFirearm: w.raffle?.prizeIsFirearm ?? false,
        note: 'Prize claim details live on the competitions page.',
        href: '/competitions',
      })),
      href: '/competitions',
    };
  }

  /** 7. Swaps — in-flight funded swaps + proposal counts. Drops the
   *  banking block and EFT references the page shows (bank details
   *  never travel through the AI; link the page instead). */
  async getMySwaps(account: AskGgAccount) {
    type SwapView = {
      swapId: string;
      status: string;
      side: string;
      fundingSetUp: boolean;
      myFunded: boolean;
      counterpartyFunded: boolean;
      payByAt: Date | null;
      give: { title: string } | null;
      get: { title: string } | null;
      giveIsFirearm: boolean;
      getIsFirearm: boolean;
      giveTracking: { status: string | null } | null;
      getTracking: { status: string | null } | null;
    };
    const [funding, mine, received] = await Promise.all([
      this.swapFunding.getMySwaps(account.clerkId),
      this.swapProposals.getMine(account.clerkId),
      this.swapProposals.getReceived(account.clerkId),
    ]);
    const swaps = (funding as unknown as { swaps: SwapView[] }).swaps ?? [];
    return {
      activeSwaps: swaps.slice(0, 8).map((s) => ({
        id: s.swapId,
        status: s.status,
        giving: clip(s.give?.title),
        getting: clip(s.get?.title),
        youPaid: s.myFunded,
        counterpartyPaid: s.counterpartyFunded,
        payBy: day(s.payByAt),
        givingIsFirearm: s.giveIsFirearm,
        gettingIsFirearm: s.getIsFirearm,
        givingShipment: s.giveTracking?.status ?? null,
        gettingShipment: s.getTracking?.status ?? null,
        href: '/my/swaps',
      })),
      proposalsSent: (mine as unknown[]).length,
      proposalsReceived: (received as unknown[]).length,
      note: 'Payment references and banking details for swap funding are shown on the swaps page itself.',
      href: '/my/swaps',
    };
  }

  /** 8. Seller earnings + payout blockers (KYC / profile gates). */
  async getSellerEarnings(account: AskGgAccount) {
    const statement = await this.sellerTools.payoutStatement(account.clerkId);
    const gate = await this.prisma.user.findUnique({
      where: { id: account.userId },
      select: { kycStatus: true, profileCompletedAt: true },
    });
    const blockers: { issue: string; fixHref: string }[] = [];
    if (gate && gate.kycStatus !== 'VERIFIED') {
      blockers.push({
        issue:
          'Identity verification (KYC) is not complete — payouts are held until it is.',
        fixHref: '/kyc/verify',
      });
    }
    if (gate && !gate.profileCompletedAt) {
      blockers.push({
        issue:
          'Seller profile (including banking details) is incomplete — needed before a payout can be sent.',
        fixHref: '/settings',
      });
    }
    type StatementRow = {
      reference: string | null;
      date: Date | string | null;
      listingTitle: string | null;
      buyerUsername: string | null;
      status: string;
      netPayout: number;
    };
    const s = statement.summary;
    return {
      period: statement.period,
      summary: {
        completedSales: s.orderCount,
        grossSalesRand: rand(s.grossSales),
        commissionRand: rand(s.totalCommission),
        processingFeesRand: rand(s.totalProcessingFees),
        netPayoutRand: rand(s.netPayout),
        refundedCount: s.refundedCount,
      },
      recentOrders: (statement.orders as unknown as StatementRow[])
        .slice(0, 5)
        .map((r) => ({
          reference: r.reference ?? null,
          date: day(r.date),
          title: clip(r.listingTitle),
          buyerUsername: r.buyerUsername ?? null,
          status: r.status,
          netPayoutRand: rand(r.netPayout),
        })),
      payoutBlockers: blockers,
      note:
        blockers.length > 0
          ? 'Payouts are BLOCKED until the blockers above are resolved.'
          : 'No payout blockers — held funds release after delivery confirmation, then pay out in the next business-day batch.',
      href: '/my/earnings',
    };
  }
}

/** Human next step for a transaction timeline (buyer/seller aware). */
function nextActionFor(
  t: {
    paidAt: Date | null;
    acceptedAt: Date | null;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
    releasedAt: Date | null;
    paymentStatus: string;
  },
  role: 'buyer' | 'seller',
): string {
  if (t.paymentStatus === 'REFUNDED') return 'This sale was refunded.';
  if (t.paymentStatus === 'DISPUTED')
    return 'This sale is in dispute — the Gun Galore team is on it.';
  if (!t.paidAt)
    return role === 'buyer'
      ? 'Payment is outstanding — complete it from the order page.'
      : 'Waiting for the buyer to pay.';
  if (!t.acceptedAt)
    return role === 'buyer'
      ? 'Waiting for the seller to accept the sale.'
      : 'Accept the sale to start the dispatch clock.';
  if (!t.dispatchedAt)
    return role === 'buyer'
      ? 'Seller is preparing dispatch.'
      : 'Dispatch the item (5-day SLA from acceptance).';
  if (!t.deliveredAt) return 'In transit — use the tracking reference.';
  if (!t.releasedAt)
    return role === 'seller'
      ? 'Delivered — funds release after the verification window.'
      : 'Delivered — confirm everything is in order on the order page.';
  return 'Complete — funds released.';
}
