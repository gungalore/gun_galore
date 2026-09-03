import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { queryFreshnessGraveyard } from '../admin/freshness-graveyard';
import { DeskSiteService } from './desk-site.service';
import { WardenService } from './warden.service';
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

/* ──────────────────────────────────────────────────────────────────────────
 * Warden
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The id prefix that marks a Warden card as a RED GATE rather than a finding.
 *
 * 🚨 LOAD-BEARING IN THREE PLACES, AND ALL THREE ARE THE SERVER'S JOB.
 * sortPile() floats a red gate to the top of its band, later() refuses to
 * sink one and act() refuses to acknowledge one. The card face carries no
 * Later and no Acknowledge button, but a card face is not a boundary:
 * POST /admin/desk/<id>/later takes any string at all and the in-memory sunk
 * map never type-checks it. If the rule does not hold here it does not hold.
 *
 * ⚠️ THE TAIL MUST STAY COLON-FREE. act() destructures `cardId.split(':')`
 * and keeps only the first two segments, so `warden:gate:VERIFYNOW_MODE`
 * would silently lose its key. Hence `gate-`, not `gate:`.
 */
const RED_GATE_ID = 'warden:gate.';
/*
 * ⚠️ THE DOT IS THE POINT, AND IT USED TO BE A HYPHEN. Warden's own
 * proposal ids are [A-Za-z0-9_-] (PROPOSAL_ID_RE in warden.service.ts), so
 * a hyphen prefix was forgeable: a proposal named "gate-nginx" read as a
 * red gate and could then never be sunk or acknowledged. A dot cannot come
 * from the daemon, so this prefix is ours by construction rather than by
 * convention. Still colon-free, so act()'s split(':') holds.
 */

/**
 * How long an acknowledged Warden finding stays off the pile.
 *
 * ⚠️ A DAY, BECAUSE THE CATALOGUE SAYS "NAGS DAILY". Acknowledge is not
 * "resolved" — nothing about the stalled outbox changed when the operator
 * tapped it. It is "I have seen this, stop showing me today", and the finding
 * comes back tomorrow if the condition is still true.
 */
const WARDEN_ACK_HOURS = 24;

/** Setting key holding the last acknowledgement of one Warden finding. */
function wardenAckKey(entityId: string): string {
  return `warden:ack:${entityId}`;
}

/**
 * How overdue an outbox row must be before Warden calls the sweep stalled.
 *
 * NotificationsService.retryOutboxEmails runs every 10 minutes and its own
 * comment says the table should normally be empty. A row still sitting there
 * half an hour after it came due has been passed over by three sweeps — that
 * is a stalled worker, not a send that happens to be waiting its turn.
 */
const OUTBOX_STALL_MINUTES = 30;

/**
 * How many dead SMS make a pattern rather than a bad number.
 *
 * A FAILED SmsLog row with no nextRetryAt is finished: either it was never
 * retryable or the retries are spent, and nothing will try it again. One is
 * usually a wrong number the member typed. Three in a day is the provider.
 */
const SMS_DEAD_LETTER_MIN = 3;

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

  constructor(
    private readonly prisma: PrismaService,
    /**
     * ⚠️ THE SITE BOARD OWNS WHICH GATES ARE RED, AND IT IS THE ONLY THING
     * THAT DOES. A red-gate card and the Config gates panel are two renderings
     * of one fact; re-reading VERIFYNOW_MODE here would give the operator a
     * board and a pile that can disagree about whether the site is safe. This
     * calls gates() and deals whatever came back `bad`.
     *
     * @Optional() with a default: DeskModule provides DeskSiteService and Nest
     * injects it, while the spec constructs DeskService with a fake prisma
     * alone. The fallback is the same read-only service over the same client,
     * so neither path can see a different set of gates.
     */
    @Optional() private readonly site: DeskSiteService = new DeskSiteService(prisma),
    /**
     * ⚠️ OPTIONAL WITH NO FALLBACK, BECAUSE THERE IS NO HONEST FALLBACK.
     * WardenService is the authenticated door to a daemon on the box; this
     * process cannot stand in for it. Absent, the pile simply carries no
     * proposals — which is the truth — rather than a plausible empty thread.
     */
    @Optional() private readonly warden?: WardenService,
  ) {}

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
      gates,
      wardenChat,
      outboxStalled,
      smsDeadLetters,
      wardenAcks,
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
        /* ── Warden ─────────────────────────────────────────────────
         *
         * 🚨 'warden' AND 'whatsapp_reply' SAT IN DeskCardType FOR WEEKS
         * WITH NOTHING PUTTING EITHER ON THE WIRE — the same failure the
         * complaint and support cards above were written to close. The
         * catalogue drew the faces, the union carried the types, and no
         * operator could ever reach one.
         *
         * The three things Warden can honestly say today, from state this
         * process can actually measure. Everything else the Warden chat
         * shows — proposals with an approvable command, Claude diagnoses,
         * the ran/output transcript — needs the WardenProposal store, which
         * does not exist yet. A card offering "Approve the fix…" with no
         * fix behind it would be worse than no card.
         */
        this.site.gates(),
        /**
         * ⚠️ present() FIRST, AND NOT AS AN OPTIMISATION. chat() is an HTTP
         * hop to the box with a read timeout on it. Warden is unconfigured on
         * every environment today, so without this the whole pile would wait
         * on a socket that was never going to answer, every load.
         */
        this.warden?.present() ? this.warden.chat() : Promise.resolve(null),
        this.prisma.emailOutbox.count({
          where: { nextAttemptAt: { lt: new Date(now - OUTBOX_STALL_MINUTES * 60_000) } },
        }),
        // FAILED with no retry due: the retry cron is finished with these, so
        // they are lost sends and not a queue still working through a backlog.
        this.prisma.smsLog.count({
          where: {
            status: 'FAILED',
            nextRetryAt: null,
            createdAt: { gte: new Date(now - 24 * 3_600_000) },
          },
        }),
        /**
         * ⚠️ Setting, NOT A NEW TABLE. An acknowledgement is one timestamp
         * per finding, and the Setting table already carries exactly this
         * shape of bookkeeping (cron:lastrun:*). A migration for a handful of
         * rows meaning "seen today" would be the wrong trade.
         */
        this.prisma.setting.findMany({ where: { key: { startsWith: 'warden:ack:' } } }),
      ]);

    /*
     * Acknowledgement rows, read ONCE for every loop that suppresses on them.
     * ⚠️ Both the findings loop and the proposals loop must consult this. The
     * proposals loop did not, and the card returned immediately.
     */
    const ackAt = new Map(wardenAcks.map((s) => [s.key, Date.parse(s.value)]));
    const ackCutoff = Date.now() - WARDEN_ACK_HOURS * 3_600_000;
    const stillAcknowledged = (entityId: string): boolean => {
      const seen = ackAt.get(wardenAckKey(entityId));
      return seen !== undefined && Number.isFinite(seen) && seen > ackCutoff;
    };

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

    /* ── Warden · red gates ───────────────────────────────────────────
     *
     * ⚠️ THE BOARD DECIDES WHAT IS RED; THIS ONLY DEALS IT. Every gate that
     * came back `bad` from DeskSiteService.gates() becomes a card, and no
     * gate is named here. Add a red gate to the board and it starts arriving
     * on the pile the same day, with no second list to remember to update.
     *
     * The headline and meta are composed from the gate's own label, value and
     * note rather than written out again. Two files describing one gate in
     * two sets of words is how the board and the pile end up disagreeing
     * about what "sandbox" means.
     *
     * ⚠️ key AND value ARE SAFE TO PRINT, AND ONLY BECAUSE gates() GUARANTEES
     * IT. Its contract is a mode string or a boolean word, never a secret,
     * never a masked tail. If that contract ever loosens, this line leaks.
     */
    for (const gate of gates.filter((g) => g.tone === 'bad')) {
      cards.push({
        // Colon-free tail — act() keeps only two segments. See RED_GATE_ID.
        id: `${RED_GATE_ID}${gate.key.replace(/[^A-Za-z0-9_]/g, '')}`,
        type: 'warden',
        typeLabel: 'Warden',
        band: 'housekeeping',
        headline: `Red gate: ${gate.label} — ${gate.value}`,
        meta: `${gate.key}=${gate.value}${gate.note ? ` · ${gate.note}` : ''} · nags daily until it flips`,
        // The padlock the catalogue draws on this face, not the bolt the
        // type would otherwise give it.
        icon: 'lock',
        tags: [{ kind: 'bad', label: 'red gate', icon: 'lock' }],
        // ⚠️ ONE ACTION, AND THAT IS THE WHOLE POINT OF THE CARD. No
        // Acknowledge and no Later: a gate that could be waved away would be
        // waved away, and the thing it is gating is whether sellers are
        // really ID-verified. It clears when the gate flips in code and never
        // because somebody was tired of seeing it.
        actions: [
          {
            key: 'chat',
            label: 'Open the chat',
            kind: 'link',
            variant: 'primary',
            href: '/admin/desk/site',
          },
        ],
        // ⚠️ NO overdueSince. env has no changed-at, so there is no honest
        // "red since". The card floats on its own rule in sortPile instead of
        // borrowing the overdue clock with an invented timestamp.
        canLater: false,
      });
    }

    /* ── Warden · proposals ───────────────────────────────────────────
     *
     * A proposal Warden raised on the box, waiting for a decision. The
     * catalogue's Warden face, with the command it wants to run behind it.
     *
     * ⚠️ PENDING ONLY, AND kind 'proposal' ONLY. A settled proposal is a line
     * in the chat, not work. And a `red_gate` proposal is the SAME FACT as
     * the gate cards above — WardenService.gates() reads its gate values from
     * DeskSiteService for exactly that reason — so dealing both would put one
     * red gate on the pile twice, once from each side of the wire.
     */
    for (const p of wardenChat?.proposals ?? []) {
      if (p.kind !== 'proposal' || p.status !== 'pending') continue;
      // The read that makes Acknowledge mean something on a proposal. act()
      // writes wardenAckKey(<tail after "warden:">), which for this card is
      // p.id — so this is the same key from the other side.
      if (stillAcknowledged(p.id)) continue;
      cards.push({
        // PROPOSAL_ID_RE in warden.service.ts is [A-Za-z0-9_-], so the tail
        // is colon-free by construction and act()'s split holds.
        id: `warden:${p.id}`,
        type: 'warden',
        typeLabel: 'Warden',
        band: 'housekeeping',
        headline: p.headline,
        meta: p.diagnosis,
        /**
         * ⚠️ THE COMMAND RIDES ON `note` BECAUSE FeedAction HAS NOWHERE ELSE
         * TO PUT IT. A money-grade confirm must restate exactly what will
         * run, and the only payload a money action carries is `amount` — a
         * rand string. Putting a shell command in a field named `amount`
         * would be a lie tsc cannot see, so the confirm reads it from here.
         */
        note: p.command ?? undefined,
        tags: [{ kind: 'info', label: 'proposal', icon: 'bolt' }],
        actions: [
          {
            key: 'chat',
            label: 'Open the chat',
            kind: 'link',
            variant: 'primary',
            href: '/admin/desk/site',
          },
          /**
           * ⚠️ 'money', NOT 'undo', AND THE UNDO WINDOW MUST NEVER REACH IT.
           * Approve ends in a command running on a production box. The undo
           * window is a client-side delay; a fix already run cannot be taken
           * back by letting a timer expire. act() refuses this action by
           * name for the same reason the money card types are refused there.
           */
          {
            key: 'approve',
            label: 'Approve the fix…',
            kind: 'money',
            variant: 'secondary',
          },
          {
            key: 'acknowledge',
            label: 'Acknowledge',
            kind: 'undo',
            variant: 'ghost',
            doneMessage: 'Acknowledged — Warden will raise it again tomorrow',
          },
        ],
        canLater: true,
      });
    }

    /* ── Warden · findings this process can see for itself ────────────
     *
     * ⚠️ ONLY WHILE WARDEN IS ABSENT, AND THAT IS THE WHOLE RULE. Warden is
     * the authority on what is wrong with the running system; when it is
     * deployed it raises its own findings on its own thread and these would
     * be the same trouble reported twice, in two voices, with two ids.
     *
     * ⚠️ "diagnosis", NOT "proposal", AND THE DIFFERENCE IS A BUTTON. These
     * carry no approvable command — this process has no shell and must never
     * have one — so they say what was found and stop there. Neither is on the
     * pile any other way: a stalled outbox and a dead SMS are invisible
     * everywhere except the Site board's channel row, which nobody opens on a
     * day when nothing looks wrong.
     */
    const findings: { key: string; headline: string; meta: string }[] = [];

    // The deferral is one condition on the whole block, not a repeated guard:
    // when Warden is up, this process has nothing to add.
    if (!wardenChat?.present) {
      if (outboxStalled > 0) {
        findings.push({
          key: 'outbox-stalled',
          headline: `The email outbox is not draining — ${outboxStalled} ${
            outboxStalled === 1 ? 'send is' : 'sends are'
          } overdue`,
          meta: `Parked ${OUTBOX_STALL_MINUTES}+ minutes past their retry time · the 10-minute sweep should have cleared them · members are not getting these emails`,
        });
      }

      if (smsDeadLetters >= SMS_DEAD_LETTER_MIN) {
        findings.push({
          key: 'sms-dead-letters',
          headline: `${smsDeadLetters} SMS were dropped and will not be retried`,
          meta: 'Failed in the last 24h with no retry pending · waybill PINs and payout notices ride this path',
        });
      }
    }

    /**
     * ⚠️ ACKNOWLEDGED, NOT RESOLVED. The condition is still true; the
     * operator has seen it. It comes back tomorrow.
     */
    // ackAt / ackCutoff / stillAcknowledged are hoisted above the proposals
    // loop — one reading of the rows for every loop that suppresses on them.

    for (const f of findings) {
      const seen = ackAt.get(wardenAckKey(f.key));
      if (seen && !Number.isNaN(seen) && seen > ackCutoff) continue;
      cards.push({
        id: `warden:${f.key}`,
        type: 'warden',
        typeLabel: 'Warden',
        band: 'housekeeping',
        headline: f.headline,
        meta: f.meta,
        tags: [{ kind: 'info', label: 'diagnosis', icon: 'bolt' }],
        actions: [
          {
            key: 'chat',
            label: 'Open the chat',
            kind: 'link',
            variant: 'primary',
            href: '/admin/desk/site',
          },
          {
            key: 'acknowledge',
            label: 'Acknowledge',
            kind: 'undo',
            variant: 'secondary',
            doneMessage: 'Acknowledged — Warden will raise it again tomorrow',
          },
        ],
        canLater: true,
      });
    }

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
        // The raw figure travels with the formatted one so the rail can
        // colour the row by its VALUE. It used to be painted amber
        // unconditionally, so a blocked total of R0 — the good state, and
        // the usual one — still read as something needing attention.
        blockedCents: money.blockedCents,
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
    // ⚠️ A RED GATE FLOATS ABOVE EVERYTHING IN ITS BAND, INCLUDING OVERDUE.
    // Housekeeping is the bottom band and a dead listing that has been dead
    // for 91 days would otherwise sort above the reason sellers are not
    // really ID-verified. It is the one card the operator cannot sink, so it
    // has to be the one they cannot scroll past either.
    const float = (c: DeskCardData) => (this.isRedGate(c.id) ? 0 : 1);
    return [...cards].sort((a, b) => {
      if (band(a) !== band(b)) return band(a) - band(b);
      if (float(a) !== float(b)) return float(a) - float(b);
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

  /**
   * Is this card id a Warden red gate?
   *
   * The id carries it, so the answer needs no row and no round trip — which
   * matters, because later() has to answer it for an id the operator posted
   * and the pile may not have been rebuilt since.
   */
  private isRedGate(cardId: string): boolean {
    return cardId.startsWith(RED_GATE_ID);
  }

  /** Sink a card for four hours. */
  later(cardId: string): { laterUntil: string } {
    // 🚨 THE RULE LIVES HERE, NOT ON THE CARD FACE. The red-gate card ships
    // no Later button, but this endpoint takes any string and the sunk map
    // is an untyped Map — omitting a button hides the door, it does not lock
    // it. A red gate that could be sunk for four hours is a red gate.
    if (this.isRedGate(cardId)) {
      throw new BadRequestException('A red gate cannot be sunk. It clears when the gate flips.');
    }
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

    // 🚨 SAME REASON AS later(). Acknowledge is the other way to make a card
    // go away for a day, and a red gate must not have one however the request
    // was built.
    if (this.isRedGate(cardId)) {
      throw new BadRequestException(
        'A red gate cannot be acknowledged. It clears when the gate flips.',
      );
    }

    /**
     * 🚨 APPROVING A WARDEN FIX RUNS A COMMAND ON A PRODUCTION BOX, SO IT
     * NEVER COMES THROUGH HERE. This is the generic card-face dispatcher and
     * the worst a bug in it should be able to do is approve a listing twice.
     * POST admin/warden/proposals/:id/approve is the one door: it re-reads
     * the proposal from the daemon, compares the command against the one the
     * operator actually confirmed, and writes an audit row. Same rule as the
     * money card types refused above, for a bigger reason.
     */
    if (type === 'warden' && action === 'approve') {
      throw new NotFoundException(
        'A Warden fix is approved from the chat, with the command restated, and never from the card face',
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
      case 'warden:acknowledge':
        // ⚠️ NOT A FIX AND NOT A RESOLUTION — a "seen it, not today". The
        // outbox is still stalled after this write; the finding is simply
        // suppressed until WARDEN_ACK_HOURS is up, and comes back if the
        // condition is still true. Anything that actually repairs the
        // condition belongs behind its own endpoint with its own confirm.
        await this.prisma.setting.upsert({
          where: { key: wardenAckKey(id) },
          create: { key: wardenAckKey(id), value: new Date().toISOString() },
          update: { value: new Date().toISOString() },
        });
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
