import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TransactionsService } from '../payments/transactions.service';
import { OffersService } from '../offers/offers.service';
import { AuctionsService } from '../auctions/auctions.service';
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
  /**
   * Which fee model priced the sale. Needed because listingPrice means two
   * different things: under BUYNOW_MARKUP it is what the BUYER paid (our fees
   * inside it), under SELLER_DEDUCT it is the seller's own sale price.
   */
  feeModel: string;
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
        // ⚠️ BOTH NUMBERS, LABELLED. saleRand alone was ambiguous: under the
        // markup model listingPrice is what the BUYER paid, which is larger
        // than anything the seller sold for, so a seller asking "what did I
        // sell it for?" got our marked-up figure back. feesInPrice tells the
        // assistant not to describe the gap as a deduction.
        buyerPaidRand: rand(t.listingPrice),
        yourPriceRand: rand(
          t.feeModel === 'BUYNOW_MARKUP' ? t.sellerPayout : t.listingPrice,
        ),
        yourPayoutRand: rand(t.sellerPayout),
        feesInPrice: t.feeModel === 'BUYNOW_MARKUP',
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

  /** W6 — validate + stage a support-ticket DRAFT. WRITES NOTHING:
   *  the returned draft renders as a card and the ticket is only
   *  created when the user taps Create (their session → POST
   *  /support). Mirrors SupportService rules (category set, fallback
   *  'general'); transactionId must belong to the caller or the draft
   *  is refused. */
  async prepareTicketDraft(
    account: AskGgAccount,
    input: {
      subject?: string;
      category?: string;
      body?: string;
      transactionId?: string;
    },
  ): Promise<{
    ok: boolean;
    draft?: {
      subject: string;
      category: string;
      body: string;
      transactionId?: string;
    };
    error?: string;
  }> {
    const subject = (input.subject ?? '').trim();
    const body = (input.body ?? '').trim();
    if (subject.length < 4) {
      return { ok: false, error: 'Subject too short — give a clear summary.' };
    }
    if (body.length < 10) {
      return {
        ok: false,
        error: 'Body too short — include what happened and when.',
      };
    }
    const TICKET_CATEGORIES = [
      'general',
      'payment',
      'shipping',
      'account',
      'listing',
      'other',
    ];
    const category = TICKET_CATEGORIES.includes(input.category ?? '')
      ? (input.category as string)
      : 'general';

    let transactionId: string | undefined;
    if (input.transactionId) {
      const ref = input.transactionId.trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(ref)) {
        return { ok: false, error: 'Invalid transaction reference.' };
      }
      const t = await this.prisma.transaction.findUnique({
        where: { id: ref },
        select: { buyerId: true, sellerId: true },
      });
      if (
        !t ||
        (t.buyerId !== account.userId && t.sellerId !== account.userId)
      ) {
        return {
          ok: false,
          error:
            'That transaction is not on your account — draft without it or use one of your own.',
        };
      }
      transactionId = ref;
    }

    return {
      ok: true,
      draft: {
        subject: clip(subject, 120),
        category,
        body: clip(body, 2_000),
        ...(transactionId ? { transactionId } : {}),
      },
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
    return 'This sale is in dispute — the All Outdoor team is on it.';
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
