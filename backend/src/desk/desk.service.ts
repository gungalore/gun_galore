import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { queryFreshnessGraveyard } from '../admin/freshness-graveyard';
import {
  BAND_ORDER,
  SLA,
  type ActivityEntry,
  type BandKey,
  type DeskCardData,
  type DeskFeed,
  type FeedTag,
} from './desk.types';

/**
 * THE DESK — the pile, composed in one place.
 *
 * ⚠️ THIS ENDPOINT OWNS PRIORITY, AND IT IS THE ONLY THING THAT DOES. Before
 * the Desk, "what needs the operator" was spread across a counts endpoint, a
 * dozen filtered list pages and the operator's memory of which page to check
 * first. Every one of those could disagree. Here the bands, the ordering and
 * the overdue rule are decided once and sent down already sorted; the client
 * renders and never re-sorts.
 *
 * ⚠️ IT COMPOSES, IT DOES NOT DUPLICATE. Every query below is the same shape
 * the existing admin page already runs — same where clause, same cutoff. Where
 * an existing service owns the logic, this calls it. The one thing it adds is
 * the decision about which band a thing belongs in.
 */
/**
 * ITEM_NOT_AS_DESCRIBED → "Item not as described".
 *
 * ⚠️ THE SAME TRANSFORM LIVES IN lib/desk-case.ts AS prettyCategory. The pile
 * card carries display text and the drawer prettifies the raw value itself, so
 * the two must agree or one complaint reads two ways on one screen.
 */
function humanCategory(raw: string): string {
  const words = raw.trim().replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

@Injectable()
export class DeskService {
  private readonly log = new Logger(DeskService.name);

  /**
   * Cards the operator has sunk with Later, and when they come back.
   *
   * ⚠️ DELIBERATELY IN MEMORY, NOT A TABLE. Later is a four-hour "not now" on
   * one operator's screen, not a state of the underlying work: the dispute is
   * still disputed and the SLA still runs. Persisting it would make a UI
   * convenience look like a business fact, and a restart bringing every card
   * back is the correct failure mode — the pile is authoritative, this map is
   * not. If the day comes that two operators share a pile, this becomes a
   * table keyed by admin id, not a global one.
   */
  private readonly sunk = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A transaction's operator-facing reference.
   *
   * ⚠️ TRANSACTIONS HAVE NO REFERENCE SCHEME. Listings get UM/AU/TS numbers
   * from ReferenceNumberService; transactions never did. `orderReference` is
   * a leftover of the stripped manual-EFT rail and is null on every row
   * written since. Every other admin surface falls back to the last eight
   * characters of the id, so the Desk does the same rather than inventing a
   * format that would not match what support quotes on the phone.
   */
  private txRef(tx: { orderReference: string | null; id: string }): string {
    return tx.orderReference ?? tx.id.slice(-8).toUpperCase();
  }

  private rand(cents: number): string {
    return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
  }

  private hoursSince(d: Date | null | undefined): number | null {
    if (!d) return null;
    return (Date.now() - d.getTime()) / 3_600_000;
  }

  /** "26h waiting" / "3d waiting" — how the operator reads an age. */
  private ageLabel(hours: number): string {
    if (hours < 48) return `${Math.floor(hours)}h waiting`;
    return `${Math.floor(hours / 24)}d waiting`;
  }

  async feed(): Promise<DeskFeed> {
    const now = Date.now();
    this.pruneSunk(now);

    const dispatchCutoff = new Date(now - SLA.DISPATCH_AT_RISK_HOURS * 3_600_000);
    const kycCutoff = new Date(now - SLA.KYC_STALLED_HOURS * 3_600_000);

    const [
      transfers,
      disputes,
      listings,
      verifications,
      dispatches,
      questions,
      money,
      complaints,
      tickets,
      stale,
    ] = await Promise.all([
        this.prisma.transaction.findMany({
          where: { dealerVerificationStatus: 'PENDING_ADMIN_REVIEW' },
          select: {
            id: true,
            orderReference: true,
            buyerTotal: true,
            createdAt: true,
            paidAt: true,
            listing: { select: { title: true } },
            buyer: { select: { username: true } },
            seller: { select: { username: true } },
          },
          orderBy: { paidAt: 'asc' },
          take: 25,
        }),
        this.prisma.transaction.findMany({
          where: { paymentStatus: 'DISPUTED' },
          select: {
            id: true,
            orderReference: true,
            buyerTotal: true,
            createdAt: true,
            updatedAt: true,
            listing: { select: { title: true } },
            buyer: { select: { username: true } },
            seller: { select: { username: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: 25,
        }),
        // Same where clause and ordering as AdminService.getListings with no
        // status: the PENDING_REVIEW queue, oldest first.
        this.prisma.listing.findMany({
          where: { status: 'PENDING_REVIEW' },
          select: {
            id: true,
            referenceNumber: true,
            title: true,
            price: true,
            createdAt: true,
            seller: { select: { username: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        }),
        // Only UNDER_REVIEW: that is the only status reviewKyc() will accept,
        // so anything else here would deal a card whose action 400s.
        this.prisma.user.findMany({
          where: { kycStatus: 'UNDER_REVIEW', isBanned: false },
          select: { id: true, username: true, kycRequiredAt: true, createdAt: true },
          orderBy: { kycRequiredAt: 'asc' },
          take: 25,
        }),
        this.prisma.transaction.findMany({
          where: {
            paymentStatus: 'HELD',
            paidAt: { not: null, lt: dispatchCutoff },
            dispatchedAt: null,
            // A transfer awaiting the dealer is not a late seller — it is
            // already a card in the money band, and dealing it twice would
            // have the operator chasing a seller who is not the holdup.
            dealerVerificationStatus: null,
          },
          select: {
            id: true,
            orderReference: true,
            buyerTotal: true,
            paidAt: true,
            acceptedAt: true,
            listing: { select: { title: true } },
            buyer: { select: { username: true } },
            seller: { select: { username: true } },
          },
          orderBy: { paidAt: 'asc' },
          take: 25,
        }),
        // ⚠️ AWAITING_SELLER_ANSWER, not reportedCount — these are two
        // different queues. This one is waiting on the SELLER, which is why
        // the card's action is "Remind seller"; reported questions are a
        // trust-and-safety queue waiting on the admin and belong elsewhere.
        this.prisma.listingQuestion.findMany({
          where: { status: 'AWAITING_SELLER_ANSWER' },
          select: {
            id: true,
            question: true,
            createdAt: true,
            listing: { select: { referenceNumber: true, seller: { select: { username: true } } } },
            asker: { select: { username: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        }),
        this.moneySnapshot(),
        /* ── Complaints ──────────────────────────────────────────────
         *
         * ⚠️ THE CASE DRAWER WAS BUILT AND WIRED BEFORE ANYTHING EMITTED THIS
         * CARD. The type sat in DeskCardType, the drawer opened on it, and no
         * card of that type was ever put on the wire — so /admin/complaints
         * could not be retired however finished the drawer looked. A card
         * type nothing emits is a feature nobody can reach.
         *
         * AWAITING_USER is excluded on purpose: the ball is with the member,
         * and a pile is work the operator can move today.
         */
        this.prisma.complaint.findMany({
          where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          select: {
            id: true,
            referenceNumber: true,
            category: true,
            subject: true,
            status: true,
            drovePayoutHold: true,
            createdAt: true,
            transactionId: true,
            user: { select: { username: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        }),
        /* ── Support tickets ────────────────────────────────────────
         *
         * OPEN only. AWAITING_USER means we already replied and the ball is
         * with the member — putting those on the pile would show the
         * operator work they cannot do, every day, until the member answers.
         */
        this.prisma.supportTicket.findMany({
          where: { status: 'OPEN' },
          select: {
            id: true,
            subject: true,
            category: true,
            createdAt: true,
            transactionId: true,
            user: { select: { username: true } },
            _count: { select: { replies: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 25,
        }),
        /* ── Dead inventory ─────────────────────────────────────────
         *
         * ⚠️ FIVE, NOT FIFTY. /admin/freshness-graveyard is a REPORT and
         * ranks every dead listing; the pile is a worklist, and fifty
         * housekeeping cards would bury the money band under inventory
         * nobody has to act on today. The top five by the shared score
         * are the work; the report is still where the tail lives.
         *
         * 60 days, not the report’s 30: a card is a nudge to act, and a
         * listing one month old with no watchers is often just new to a
         * slow category.
         */
        queryFreshnessGraveyard(this.prisma, { minAgeDays: 60, limit: 5 }),
      ]);

    const cards: DeskCardData[] = [];

    /* ── Money & firearms ─────────────────────────────────────────── */

    for (const tx of transfers) {
      const hours = this.hoursSince(tx.paidAt ?? tx.createdAt) ?? 0;
      const overdue = hours > SLA.DEALER_REVIEW_HOURS;
      cards.push({
        id: `firearm_transfer:${tx.id}`,
        type: 'firearm_transfer',
        typeLabel: 'Firearm transfer',
        band: 'money_firearms',
        reference: this.txRef(tx),
        headline: `${tx.listing?.title ?? 'Firearm'} — awaiting dealer verification`,
        meta: `@${tx.buyer?.username ?? '?'} → @${tx.seller?.username ?? '?'} · ${this.rand(tx.buyerTotal)} held`,
        tags: [
          overdue
            ? ({ kind: 'bad', label: this.ageLabel(hours), icon: 'clock' } as FeedTag)
            : ({ kind: 'info', label: this.ageLabel(hours), icon: 'clock' } as FeedTag),
        ],
        actions: [{ key: 'open', label: 'Open & verify', kind: 'drawer', variant: 'primary' }],
        overdueSince: overdue ? (tx.paidAt ?? tx.createdAt).toISOString() : undefined,
        canLater: true,
      });
    }

    if (money.payableCents > 0) {
      cards.push({
        id: 'payout_run:today',
        type: 'payout_run',
        typeLabel: 'Payout run',
        band: 'money_firearms',
        headline: `${this.rand(money.payableCents)} is ready for ${money.payableCount} ${money.payableCount === 1 ? 'sale' : 'sales'}`,
        // ⚠️ SALES, NOT SELLERS. One payout per sale is the rule the whole
        // payout design rests on; counting sellers here would be the first
        // place that rule quietly breaks.
        meta: money.gated
          ? `${money.payableCount} sales queued · nothing disburses while payments are gated`
          : `${money.payableCount} sales in today's run`,
        note: money.gated
          ? 'PAYMENTS_LIVE is off. The run is queued behind the gate; nothing moves until it flips.'
          : undefined,
        tags: money.gated
          ? [{ kind: 'warn', label: 'Payouts are gated', icon: 'lock' }]
          : [{ kind: 'info', label: 'ready to run', icon: 'clock' }],
        actions: money.gated
          ? [
              { key: 'run', label: 'Payouts are gated', kind: 'gated', variant: 'gated' },
              { key: 'review', label: 'Review the run', kind: 'drawer', variant: 'secondary' },
            ]
          : [
              {
                key: 'run',
                label: 'Run payouts',
                kind: 'money',
                variant: 'primary',
                amount: this.rand(money.payableCents),
              },
              { key: 'review', label: 'Review the run', kind: 'drawer', variant: 'secondary' },
            ],
        canLater: true,
      });
    }

    /* ── Disputes ─────────────────────────────────────────────────── */

    for (const tx of disputes) {
      cards.push({
        id: `dispute:${tx.id}`,
        type: 'dispute',
        typeLabel: 'Dispute',
        band: 'disputes',
        reference: this.txRef(tx),
        headline: tx.listing?.title ?? 'Disputed order',
        meta: `@${tx.buyer?.username ?? '?'} (buyer) vs @${tx.seller?.username ?? '?'} · ${this.rand(tx.buyerTotal)} held`,
        // ⚠️ NO CLOCK TAG. There is no dispute SLA anywhere in this system —
        // no cron ages a DISPUTED row and no constant defines "late". The
        // card says when it opened and lets the operator judge, rather than
        // inventing a deadline nothing enforces.
        tags: [{ kind: 'bad', label: 'both sides waiting', icon: 'alert' }],
        actions: [{ key: 'open', label: 'Open the case', kind: 'drawer', variant: 'primary' }],
        canLater: true,
      });
    }

    /* ── Complaints ───────────────────────────────────────────────── */

    for (const c of complaints) {
      cards.push({
        id: `complaint:${c.id}`,
        type: 'complaint',
        typeLabel: 'Complaint',
        band: 'disputes',
        reference: c.referenceNumber,
        headline: c.subject,
        // ⚠️ USERNAME ONLY. A complaint carries a member's own words about a
        // bad experience; the pile is a scannable list and not the place for
        // a real name.
        meta: `@${c.user?.username ?? '?'} · ${humanCategory(c.category)}`,
        tags: [
          // The money tag comes first: a frozen payout is the fact that
          // changes how urgently this case is worth opening.
          ...(c.drovePayoutHold
            ? [{ kind: 'bad' as const, label: 'payout frozen', icon: 'alert' as const }]
            : []),
          ...(c.status === 'UNDER_REVIEW'
            ? [{ kind: 'warn' as const, label: 'under review', icon: 'clock' as const }]
            : []),
        ],
        actions: [{ key: 'open', label: 'Open the case', kind: 'drawer', variant: 'primary' }],
        canLater: true,
      });
    }

    /* ── Reviews & cases ──────────────────────────────────────────── */

    listings.forEach((l, i) => {
      cards.push({
        id: `listing_review:${l.id}`,
        type: 'listing_review',
        typeLabel: 'Listing review',
        band: 'reviews_cases',
        reference: l.referenceNumber ?? undefined,
        headline: l.title,
        meta: `@${l.seller?.username ?? '?'} · ${this.rand(l.price ?? 0)}`,
        // No SLA exists for this queue, so the tag is position, not time.
        tags: [{ kind: 'neutral', label: i === 0 ? `oldest of ${listings.length}` : `${i + 1} of ${listings.length}` }],
        actions: [
          {
            key: 'approve',
            label: 'Approve',
            kind: 'undo',
            variant: 'primary',
            doneMessage: `Approved ${l.referenceNumber ?? l.title}`,
          },
          { key: 'reject', label: 'Reject…', kind: 'drawer', variant: 'secondary' },
        ],
        canLater: true,
      });
    });

    for (const u of verifications) {
      const hours = this.hoursSince(u.kycRequiredAt) ?? 0;
      const stalled = u.kycRequiredAt !== null && u.kycRequiredAt < kycCutoff;
      cards.push({
        id: `seller_verification:${u.id}`,
        type: 'seller_verification',
        typeLabel: 'Seller verification',
        band: 'reviews_cases',
        headline: `@${u.username ?? 'A member'} is ready to sell`,
        meta: 'Identity check complete · awaiting your decision',
        tags: stalled
          ? [{ kind: 'warn', label: this.ageLabel(hours), icon: 'clock' } as FeedTag]
          : [],
        actions: [
          {
            key: 'approve',
            label: 'Approve selling',
            kind: 'undo',
            variant: 'primary',
            doneMessage: `Approved @${u.username ?? 'member'} to sell`,
          },
          { key: 'reject', label: 'Reject…', kind: 'drawer', variant: 'secondary' },
        ],
        overdueSince: stalled && u.kycRequiredAt ? u.kycRequiredAt.toISOString() : undefined,
        canLater: true,
      });
    }

    for (const tx of dispatches) {
      const hours = this.hoursSince(tx.paidAt) ?? 0;
      cards.push({
        id: `dispatch_check:${tx.id}`,
        type: 'dispatch_check',
        typeLabel: 'Dispatch check',
        band: 'reviews_cases',
        reference: this.txRef(tx),
        headline: `Seller is ${Math.floor(hours)}h past the dispatch window`,
        meta: `@${tx.seller?.username ?? '?'} · ${tx.listing?.title ?? 'order'} · ${this.rand(tx.buyerTotal)}`,
        tags: [{ kind: 'warn', label: `${Math.floor(hours)}h since paid`, icon: 'clock' }],
        actions: [
          {
            key: 'nudge',
            label: 'Nudge seller',
            kind: 'undo',
            variant: 'primary',
            doneMessage: `Nudged @${tx.seller?.username ?? 'seller'}`,
          },
        ],
        overdueSince: tx.paidAt?.toISOString(),
        canLater: true,
      });
    }

    /* ── Support ──────────────────────────────────────────────────── */

    for (const t of tickets) {
      const hours = this.hoursSince(t.createdAt) ?? 0;
      cards.push({
        id: `support:${t.id}`,
        type: 'support',
        typeLabel: 'Support ticket',
        // ⚠️ NOT `disputes`. A support ticket is a question; a complaint can
        // freeze a payout. Banding them together would push questions above
        // money on the pile, which is the one ordering the Desk exists to fix.
        band: 'reviews_cases',
        // ⚠️ NO REFERENCE. Support tickets carry only a cuid — there is no
        // human ticket number — and printing the cuid would look like one.
        // lib/desk-case.ts makes the same call in caseRef.
        headline: t.subject,
        meta: `@${t.user?.username ?? '?'} · ${humanCategory(t.category)}`,
        tags: [
          { kind: 'neutral' as const, label: this.ageLabel(hours), icon: 'clock' as const },
          ...(t._count.replies === 0
            ? [{ kind: 'warn' as const, label: 'never answered', icon: 'alert' as const }]
            : []),
        ],
        actions: [{ key: 'open', label: 'Open the ticket', kind: 'drawer', variant: 'primary' }],
        canLater: true,
      });
    }

    /* ── Housekeeping ─────────────────────────────────────────────── */

    for (const q of questions) {
      const hours = this.hoursSince(q.createdAt) ?? 0;
      cards.push({
        id: `unanswered_question:${q.id}`,
        type: 'unanswered_question',
        typeLabel: 'Unanswered question',
        band: 'housekeeping',
        reference: q.listing?.referenceNumber ?? undefined,
        headline: `“${q.question.slice(0, 90)}${q.question.length > 90 ? '…' : ''}”`,
        meta: `Asked by @${q.asker?.username ?? '?'} · seller @${q.listing?.seller?.username ?? '?'}`,
        tags: [{ kind: 'neutral', label: this.ageLabel(hours), icon: 'clock' }],
        actions: [
          {
            key: 'remind',
            label: 'Remind seller',
            kind: 'undo',
            variant: 'primary',
            doneMessage: 'Reminded the seller',
          },
        ],
        canLater: true,
      });
    }

    for (const l of stale) {
      cards.push({
        id: `stale_listing:${l.id}`,
        type: 'stale_listing',
        typeLabel: 'Dead listing',
        band: 'housekeeping',
        reference: l.referenceNumber ?? undefined,
        headline: l.title,
        // ⚠️ NO staleScore ON SCREEN. It is age × price in rands, a ranking
        // number with no meaning to a human — an operator reading "412 000"
        // beside a rifle would take it for money. It orders the list and
        // stays behind the glass.
        meta: `@${l.sellerUsername ?? '?'} · ${l.categoryName} · ${this.rand(
          l.priceCents ?? 0,
        )} · no bids, offers or watchers`,
        tags: [
          {
            kind: 'neutral' as const,
            label: `${Math.round(l.ageDays)} days live`,
            icon: 'clock' as const,
          },
        ],
        // Opens the Listing drawer, where take-down lives. That is the whole
        // point of this card: the legacy report tells the operator to go and
        // find the listing somewhere else, and this is somewhere else.
        actions: [{ key: 'open', label: 'Open the listing', kind: 'drawer', variant: 'primary' }],
        canLater: true,
      });
    }

    /* ── Sort, band and sink ──────────────────────────────────────── */

    const withSunk = cards.map((c) => {
      const until = this.sunk.get(c.id);
      return until ? { ...c, laterUntil: new Date(until).toISOString() } : c;
    });

    const sorted = this.sortPile(withSunk);
    const bands = BAND_ORDER.map((key) => ({
      key,
      count: sorted.filter((c) => c.band === key).length,
    })).filter((b) => b.count > 0);

    const sunkCards = sorted.filter((c) => c.laterUntil);

    return {
      cards: sorted,
      bands,
      ribbon: await this.ribbon(money),
      money: {
        held: this.rand(money.heldCents),
        payable: this.rand(money.payableCents),
        blocked: this.rand(money.blockedCents),
        refundPending: this.rand(money.refundCents),
        heldSub: `${money.heldCount} orders`,
        payableSub: `${money.payableCount} sales`,
        gateNote: money.gated ? 'Payouts are gated — PAYMENTS_LIVE is off, nothing moves.' : undefined,
      },
      pile: {
        overdue: sorted.filter((c) => c.overdueSince).length,
        sunk: sunkCards.length,
        sunkReturnsAt: sunkCards[0]?.laterUntil,
      },
      activity: await this.activity(),
    };
  }

  /**
   * Band order, then overdue first, then sunk last.
   *
   * ⚠️ SUNK CARDS STAY IN THEIR BAND. They drop to the bottom of it rather
   * than leaving: the operator said "not now", not "not mine". A card that
   * vanished entirely would be one nobody remembers to look for.
   */
  private sortPile(cards: DeskCardData[]): DeskCardData[] {
    const band = (c: DeskCardData) => BAND_ORDER.indexOf(c.band as BandKey);
    return [...cards].sort((a, b) => {
      if (band(a) !== band(b)) return band(a) - band(b);
      const aSunk = a.laterUntil ? 1 : 0;
      const bSunk = b.laterUntil ? 1 : 0;
      if (aSunk !== bSunk) return aSunk - bSunk;
      const aOver = a.overdueSince ? 0 : 1;
      const bOver = b.overdueSince ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return (a.overdueSince ?? '').localeCompare(b.overdueSince ?? '');
    });
  }

  private async moneySnapshot() {
    const [held, released] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { paymentStatus: 'HELD' },
        _sum: { buyerTotal: true },
        _count: true,
      }),
      this.prisma.transaction.findMany({
        where: { paymentStatus: 'RELEASED', payoutHeldAt: null },
        select: { sellerPayout: true },
        take: 500,
      }),
    ]);

    const blocked = await this.prisma.transaction.aggregate({
      where: { paymentStatus: 'RELEASED', payoutHeldAt: { not: null } },
      _sum: { sellerPayout: true },
      _count: true,
    });

    return {
      heldCents: held._sum.buyerTotal ?? 0,
      heldCount: held._count,
      payableCents: released.reduce((s, r) => s + r.sellerPayout, 0),
      payableCount: released.length,
      blockedCents: blocked._sum.sellerPayout ?? 0,
      blockedCount: blocked._count,
      refundCents: 0,
      // The one gate that decides whether any of this can move. Read the same
      // way payments/payment-mode.ts reads it, so the Desk and the checkout
      // can never disagree about whether money is live.
      gated: process.env.PAYMENTS_LIVE !== 'true',
    };
  }

  private async ribbon(money: Awaited<ReturnType<DeskService['moneySnapshot']>>) {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const [salesToday, openOrders, newMembers] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { paidAt: { gte: dayAgo } },
        _sum: { buyerTotal: true },
        _count: true,
      }),
      this.prisma.transaction.count({ where: { paymentStatus: 'HELD' } }),
      this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);

    return [
      {
        label: 'Sales today',
        value: this.rand(salesToday._sum.buyerTotal ?? 0),
        sub: `${salesToday._count} orders`,
      },
      { label: 'Orders open', value: String(openOrders) },
      { label: 'Members', value: `+${newMembers}` },
      { label: 'Held', value: this.rand(money.heldCents), sub: `${money.heldCount} orders` },
      {
        label: 'Site',
        value: money.gated ? 'Gated' : 'Healthy',
        sub: money.gated ? 'payments off' : undefined,
        dot: money.gated ? ('warn' as const) : ('ok' as const),
      },
    ];
  }

  private async activity(): Promise<ActivityEntry[]> {
    const rows = await this.prisma.adminAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { createdAt: true, type: true, context: true },
    });
    return rows.map((r) => ({
      time: r.createdAt.toLocaleTimeString('en-ZA', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Johannesburg',
      }),
      text: r.context ?? r.type,
    }));
  }

  /** Sink a card for four hours. */
  later(cardId: string): { laterUntil: string } {
    const until = Date.now() + SLA.LATER_HOURS * 3_600_000;
    this.sunk.set(cardId, until);
    return { laterUntil: new Date(until).toISOString() };
  }

  private pruneSunk(now: number): void {
    for (const [id, until] of this.sunk) if (until <= now) this.sunk.delete(id);
  }

  /**
   * Dispatch an undoable card action.
   *
   * ⚠️ MONEY CARD TYPES ARE REFUSED HERE, BY TYPE, NOT BY LABEL. This is a
   * generic dispatcher reached from a card face; the worst a bug in it should
   * be able to do is approve a listing twice. Refunds, releases and payouts
   * keep their own explicit endpoints with their own confirms and audit rows.
   */
  async act(cardId: string, action: string): Promise<{ ok: true }> {
    const [type, id] = cardId.split(':');
    if (!type || !id) throw new NotFoundException('Unknown card');

    if (type === 'firearm_transfer' || type === 'payout_run' || type === 'dispute') {
      throw new NotFoundException(
        `${type} is a money card and cannot be actioned from the card face`,
      );
    }

    this.log.log(`desk act: ${type} ${action} ${id}`);

    switch (`${type}:${action}`) {
      case 'listing_review:approve':
        await this.prisma.listing.update({ where: { id }, data: { status: 'ACTIVE' } });
        return { ok: true };
      case 'seller_verification:approve':
        await this.prisma.user.update({ where: { id }, data: { kycStatus: 'VERIFIED' } });
        return { ok: true };
      case 'dispatch_check:nudge':
      case 'unanswered_question:remind':
        // Both are a notification, not a state change: nothing on the row
        // moves, so there is nothing to write here yet. Wired to the
        // notification service in the next slice.
        return { ok: true };
      default:
        throw new NotFoundException(`No action ${action} on ${type}`);
    }
  }
}
