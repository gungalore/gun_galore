import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreditsService } from './admin-credits.service';

/**
 * Powers the redesigned admin overview ("command center"). Three
 * concerns:
 *
 *   1. attentionQueue — counts of things that need an operator's eyes
 *      RIGHT NOW. Each card on the dashboard renders with a deep-link
 *      so the admin can jump straight into the queue.
 *
 *   2. todayPulse — four "what happened today" KPIs (GMV, sales count,
 *      new users, new listings). Resets at midnight SAST (Postgres
 *      uses UTC internally — we compute today as start-of-day UTC,
 *      which is "yesterday 22:00 SAST onwards" but that's close enough
 *      for the headline strip; the analytics page is the source of
 *      truth for precise figures).
 *
 *   3. activityFeed — a unified stream of recent marketplace events:
 *      new listings, sales, refunds, KYC submissions, ban actions,
 *      admin alerts. Each item has a stable shape so the UI can render
 *      them with one component.
 *
 * All queries are bounded (limit 30 per source, joined, then sorted +
 * truncated) so the page renders in <100ms even on a busy day.
 */

export interface AttentionQueue {
  pendingListings: number;
  kycStalled: number; // kycRequiredAt > 24h ago && !verified
  dispatchSlaAtRisk: number; // paid > 24h ago && !dispatched
  disputedPayments: number;
  unresolvedAlerts: number;
  feeBypassAttempts7d: number; // contact-detail filter would track this; placeholder until persisted
  // External-service credits at or below the operator-configured
  // alarm threshold. Sourced from CreditSnapshot (most recent row per
  // service) compared to CreditThreshold.alarmThreshold. ALARM-grade
  // — a live service running on empty silently breaks user-facing
  // flows (OTP not received, image upload 4xx, KYC stuck spinner).
  creditsBelowAlarm: number;
  // Sales where the buyer paid but the seller blew past the 48h
  // accept deadline without acting. Flagged by the
  // acceptEscalationSweep cron (TasksService). Admin needs to either
  // give the seller more time or force-refund the buyer. URGENT-grade
  // — the buyer's money has been held for 2+ days with no commitment.
  salesAwaitingAccept: number;
  // FLOW-F4 (H17) — firearm dealer-verifications sitting in
  // PENDING_ADMIN_REVIEW (Claude was uncertain, threw, or wasn't
  // configured). URGENT-grade: the buyer's payment is HELD until a human
  // approves the SAPS 534 / stock-register / serial photos in the dossier.
  dealerVerificationsPendingReview: number;
  // DD-F — Daily Deals JIT fulfilment needing an operator: (a) a stock-ready
  // deal PO whose buyers' parcels are still HELD + unbooked past the deal's
  // own shipsInDaysMax window (supplier collection overdue), OR (b) a deal PO
  // row that FAILED at placement (never reached Zoho). INERT with deals off
  // (0). Frontend renders a "Supplier fulfilment" card.
  dealFulfilmentAttention: number;
}

export interface TodayPulse {
  gmvCents: number;
  salesCount: number;
  newUsers: number;
  newListings: number;
}

export type ActivityEventType =
  | 'LISTING_PUBLISHED'
  | 'LISTING_SOLD'
  | 'TRANSACTION_PAID'
  | 'TRANSACTION_RELEASED'
  | 'TRANSACTION_REFUNDED'
  | 'TRANSACTION_DISPUTED'
  | 'USER_REGISTERED'
  | 'USER_BANNED'
  | 'KYC_SUBMITTED'
  | 'KYC_VERIFIED'
  | 'ADMIN_ACTION'
  | 'ADMIN_ALERT'
  | 'OFFER_SUBMITTED';

export interface ActivityEvent {
  id: string; // unique per source — prefixed so the union doesn't collide
  type: ActivityEventType;
  title: string; // one-line "what happened"
  subtitle?: string; // optional context
  href?: string; // admin-side deep link
  occurredAt: Date;
  urgent?: boolean;
}

@Injectable()
export class AdminCommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    // Used purely for the `creditsBelowAlarm` count surfaced in the
    // attention queue. AdminCreditsService is registered as a provider
    // of AdminModule already, so DI hands us the same singleton the
    // /admin/credits page uses.
    private readonly adminCredits: AdminCreditsService,
  ) {}

  // -------------------------------------------------------------------
  // Attention queue — every number here should be CLICKABLE on the
  // frontend, jumping the admin to the underlying queue. We don't fetch
  // the actual rows; just the counts.
  // -------------------------------------------------------------------
  async attentionQueue(): Promise<AttentionQueue> {
    const now = new Date();
    const day = 24 * 3600 * 1000;
    const kycStalledCutoff = new Date(now.getTime() - day);
    const dispatchCutoff = new Date(now.getTime() - day);
    const week = new Date(now.getTime() - 7 * day);

    const [
      pendingListings,
      kycStalled,
      dispatchSlaAtRisk,
      disputedPayments,
      unresolvedAlerts,
      feeBypassAttempts7d,
      creditsBelowAlarm,
      salesAwaitingAccept,
      dealerVerificationsPendingReview,
      dealFulfilmentAttention,
    ] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      // NOTE: the old manual-EFT "PENDING_ADMIN_VERIFICATION" count was
      // removed with the EFT strip — nothing can produce that status any
      // more, so the card read 0 forever. Re-add a pay-in verification
      // card here when the new payment rail lands, if it needs one.
      this.prisma.user.count({
        where: {
          kycRequiredAt: { not: null, lt: kycStalledCutoff },
          kycStatus: { not: 'VERIFIED' },
          isBanned: false,
        },
      }),
      this.prisma.transaction.count({
        where: {
          paymentStatus: 'HELD',
          paidAt: { not: null, lt: dispatchCutoff },
          dispatchedAt: null,
        },
      }),
      this.prisma.transaction.count({ where: { paymentStatus: 'DISPUTED' } }),
      this.prisma.adminAlert.count({ where: { resolved: false } }),
      // Real count from the ContactDetailRejection table (T2-1 wired
      // the filter to persist). Was hardcoded to 0 before that table
      // existed.
      this.prisma.contactDetailRejection.count({
        where: { createdAt: { gte: week } },
      }),
      // External services at/below their alarm threshold. Delegated to
      // AdminCreditsService so the per-service comparison logic lives
      // in one place. Returns 0 when the operator hasn't configured
      // any thresholds yet (so the card stays calm by default).
      this.adminCredits.countServicesBelowAlarm(),
      // TOK-7 Phase 2: stalled sales — paid but seller didn't accept
      // within 48h and the escalation cron has flagged them. Only the
      // escalated rows count — sales still inside their 48h window
      // are the seller's responsibility, not admin's.
      this.prisma.transaction.count({
        where: {
          acceptEscalatedAt: { not: null },
          acceptedAt: null,
          rejectedAt: null,
          paymentStatus: 'HELD',
        },
      }),
      // FLOW-F4 (H17): firearm verifications awaiting a human decision, funds
      // still HELD. The uploadAndScore alert + ageing sweep raise the noisy
      // signal; this is the standing count on the command-center card.
      this.prisma.transaction.count({
        where: {
          dealerVerificationStatus: 'PENDING_ADMIN_REVIEW',
          paymentStatus: 'HELD',
        },
      }),
      // DD-F — Daily Deals JIT fulfilment attention. Two failure modes summed
      // into one card count: (a) a stock-ready deal PO whose buyers' parcels
      // are still HELD + unbooked (shipmentBookedAt null; excludes
      // consolidation siblings + refund children) past the deal's own
      // shipsInDaysMax window — supplier collection is overdue; and (b) a deal
      // PO row that FAILED at placement (zohoPurchaseOrderId null AND
      // zohoSyncStatus FAILED — the same real failures the
      // retryMissingDealPurchaseOrders cron chases). The per-deal overdue
      // window (stockReadyAt + shipsInDaysMax) can't be compared to `now` in a
      // single Prisma where, so (a) is filtered in JS. INERT with deals off —
      // both queries return 0.
      (async (): Promise<number> => {
        const [failedPos, stockReadyPos] = await Promise.all([
          // (b) Actual PO failures — a row that never reached Zoho
          // (zohoPurchaseOrderId null) whose last sync FAILED. Keyed on the ROW,
          // not on "an ENDED/SOLD_OUT deal with a null PO": killswitch-ended
          // deals intentionally carry no PO and zero-sale deals carry a terminal
          // CANCELLED/OK row — neither is a real failure to flag.
          this.prisma.dealPurchaseOrder.count({
            where: {
              zohoPurchaseOrderId: null,
              zohoSyncStatus: 'FAILED',
            },
          }),
          this.prisma.dealPurchaseOrder.findMany({
            where: {
              stockReadyAt: { not: null },
              deal: {
                listing: {
                  transactions: {
                    some: {
                      paymentStatus: 'HELD',
                      shipmentBookedAt: null,
                      shipsWithId: null,
                      refundOfId: null,
                    },
                  },
                },
              },
            },
            select: {
              stockReadyAt: true,
              deal: { select: { shipsInDaysMax: true } },
            },
          }),
        ]);
        const nowMs = now.getTime();
        const overdue = stockReadyPos.filter(
          (po) =>
            po.stockReadyAt != null &&
            nowMs - po.stockReadyAt.getTime() > po.deal.shipsInDaysMax * day,
        ).length;
        return failedPos + overdue;
      })(),
    ]);

    return {
      pendingListings,
      kycStalled,
      dispatchSlaAtRisk,
      disputedPayments,
      unresolvedAlerts,
      feeBypassAttempts7d,
      creditsBelowAlarm,
      salesAwaitingAccept,
      dealerVerificationsPendingReview,
      dealFulfilmentAttention,
    };
  }

  // -------------------------------------------------------------------
  // Today's pulse — four KPIs since 00:00 SAST. Used in the headline
  // strip above the activity feed.
  // -------------------------------------------------------------------
  //
  // Critical: this is THE number an operator looks at in the morning
  // to ask "are we on track today?". Earlier version used UTC midnight
  // which, at 06:00 SAST, would silently include 8 hours of yesterday.
  // We compute SAST midnight in JS (Africa/Johannesburg is UTC+2 with
  // no DST, so just shifting works) and pass that UTC instant as the
  // `gte` cutoff to Prisma.
  async todayPulse(): Promise<TodayPulse> {
    const since = startOfTodaySast();

    const [salesAgg, newUsers, newListings] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          paymentStatus: 'RELEASED',
          releasedAt: { gte: since },
        },
        _sum: { buyerTotal: true },
        _count: true,
      }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.listing.count({
        where: { createdAt: { gte: since }, status: { not: 'DRAFT' } },
      }),
    ]);

    return {
      gmvCents: salesAgg._sum.buyerTotal ?? 0,
      salesCount: salesAgg._count,
      newUsers,
      newListings,
    };
  }

  // -------------------------------------------------------------------
  // Activity feed — union of recent events across the marketplace.
  // Each source contributes up to 30 events; we then merge, sort, and
  // truncate to `limit` so the page renders fast even on a busy day.
  // -------------------------------------------------------------------
  async activityFeed(limit = 30): Promise<ActivityEvent[]> {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7-day window

    const [
      listings,
      paid,
      released,
      refunded,
      disputed,
      newUsers,
      bannedUsers,
      kycSubmissions,
      kycVerified,
      adminActions,
      alerts,
      offers,
    ] = await Promise.all([
      this.prisma.listing.findMany({
        where: { createdAt: { gte: since }, status: { not: 'DRAFT' } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          referenceNumber: true,
          title: true,
          createdAt: true,
          listingType: true,
          status: true,
          seller: { select: { username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { paidAt: { gte: since } },
        orderBy: { paidAt: 'desc' },
        take: 30,
        select: {
          id: true,
          paidAt: true,
          buyerTotal: true,
          listing: { select: { title: true } },
          buyer: { select: { username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { releasedAt: { gte: since } },
        orderBy: { releasedAt: 'desc' },
        take: 30,
        select: {
          id: true,
          releasedAt: true,
          sellerPayout: true,
          listing: { select: { title: true } },
          seller: { select: { username: true } },
        },
      }),
      this.prisma.transaction.findMany({
        // refundOfId: null — synthetic refund-slice children (P0.3) would
        // duplicate every refund in the activity feed.
        where: { paymentStatus: 'REFUNDED', refundOfId: null, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: {
          id: true,
          updatedAt: true,
          buyerTotal: true,
          listing: { select: { title: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: { paymentStatus: 'DISPUTED', updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: {
          id: true,
          updatedAt: true,
          listing: { select: { title: true } },
          buyer: { select: { username: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, createdAt: true, username: true, email: true },
      }),
      this.prisma.user.findMany({
        where: { bannedAt: { gte: since } },
        orderBy: { bannedAt: 'desc' },
        take: 30,
        select: { id: true, bannedAt: true, username: true },
      }),
      this.prisma.user.findMany({
        where: { kycRequiredAt: { gte: since } },
        orderBy: { kycRequiredAt: 'desc' },
        take: 30,
        select: { id: true, kycRequiredAt: true, username: true },
      }),
      this.prisma.user.findMany({
        where: { kycVerifiedAt: { gte: since } },
        orderBy: { kycVerifiedAt: 'desc' },
        take: 30,
        select: { id: true, kycVerifiedAt: true, username: true },
      }),
      this.prisma.adminAuditEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          action: true,
          resourceType: true,
          resourceId: true,
          adminUser: { select: { email: true } },
        },
      }),
      this.prisma.adminAlert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          type: true,
          context: true,
          urgent: true,
          resolved: true,
        },
      }),
      this.prisma.offer.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          offerAmount: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { username: true } },
        },
      }),
    ]);

    const events: ActivityEvent[] = [];

    for (const l of listings) {
      events.push({
        id: `listing-new-${l.id}`,
        type: 'LISTING_PUBLISHED',
        title: `New ${formatType(l.listingType)} — ${l.title}`,
        subtitle: `${l.seller.username ?? 'Anonymous'}${l.referenceNumber ? ` · ${l.referenceNumber}` : ''}`,
        href: `/admin/listings/${l.id}`,
        occurredAt: l.createdAt,
      });
    }
    for (const t of paid) {
      events.push({
        id: `tx-paid-${t.id}`,
        type: 'TRANSACTION_PAID',
        title: `Sale paid — ${t.listing.title}`,
        subtitle: `${t.buyer.username ?? 'Anonymous'} · ${formatRand(t.buyerTotal)}`,
        href: `/admin/transactions/${t.id}`,
        occurredAt: t.paidAt!,
      });
    }
    for (const t of released) {
      events.push({
        id: `tx-released-${t.id}`,
        type: 'TRANSACTION_RELEASED',
        title: `Payout released — ${t.listing.title}`,
        subtitle: `${t.seller.username ?? 'Anonymous'} · ${formatRand(t.sellerPayout)}`,
        href: `/admin/transactions/${t.id}`,
        occurredAt: t.releasedAt!,
      });
    }
    for (const t of refunded) {
      events.push({
        id: `tx-refunded-${t.id}`,
        type: 'TRANSACTION_REFUNDED',
        title: `Refunded — ${t.listing.title}`,
        subtitle: formatRand(t.buyerTotal),
        href: `/admin/transactions/${t.id}`,
        occurredAt: t.updatedAt,
      });
    }
    for (const t of disputed) {
      events.push({
        id: `tx-disputed-${t.id}`,
        type: 'TRANSACTION_DISPUTED',
        title: `DISPUTED — ${t.listing.title}`,
        subtitle: `${t.buyer.username ?? 'Anonymous'} raised it`,
        href: `/admin/transactions/${t.id}`,
        occurredAt: t.updatedAt,
        urgent: true,
      });
    }
    for (const u of newUsers) {
      events.push({
        id: `user-new-${u.id}`,
        type: 'USER_REGISTERED',
        title: `New user — ${u.username ?? u.email}`,
        href: `/admin/users/${u.id}`,
        occurredAt: u.createdAt,
      });
    }
    for (const u of bannedUsers) {
      events.push({
        id: `user-banned-${u.id}`,
        type: 'USER_BANNED',
        title: `Banned — ${u.username ?? '(no username)'}`,
        href: `/admin/users/${u.id}`,
        occurredAt: u.bannedAt!,
        urgent: true,
      });
    }
    for (const u of kycSubmissions) {
      events.push({
        id: `kyc-submitted-${u.id}`,
        type: 'KYC_SUBMITTED',
        title: `KYC started — ${u.username ?? '(no username)'}`,
        href: `/admin/users/${u.id}`,
        occurredAt: u.kycRequiredAt!,
      });
    }
    for (const u of kycVerified) {
      events.push({
        id: `kyc-verified-${u.id}`,
        type: 'KYC_VERIFIED',
        title: `KYC verified — ${u.username ?? '(no username)'}`,
        href: `/admin/users/${u.id}`,
        occurredAt: u.kycVerifiedAt!,
      });
    }
    for (const a of adminActions) {
      events.push({
        id: `admin-${a.id}`,
        type: 'ADMIN_ACTION',
        title: `${a.action.replace(/_/g, ' ').toLowerCase()}`,
        subtitle: `${a.adminUser.email}${a.resourceType ? ` · ${a.resourceType}` : ''}`,
        href: adminActionHref(a.resourceType, a.resourceId),
        occurredAt: a.createdAt,
      });
    }
    for (const al of alerts) {
      events.push({
        id: `alert-${al.id}`,
        type: 'ADMIN_ALERT',
        title: `Alert — ${al.type.replace(/_/g, ' ').toLowerCase()}`,
        subtitle: al.context ?? undefined,
        href: '/admin', // future: dedicated alerts page
        occurredAt: al.createdAt,
        urgent: al.urgent,
      });
    }
    for (const o of offers) {
      events.push({
        id: `offer-${o.id}`,
        type: 'OFFER_SUBMITTED',
        title: `Offer — ${o.listing.title}`,
        subtitle: `${o.buyer.username ?? 'Anonymous'} · ${formatRand(o.offerAmount)}`,
        href: `/admin/listings/${o.listing.id}`,
        occurredAt: o.createdAt,
      });
    }

    events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return events.slice(0, limit);
  }
}

// -------------------------------------------------------------------
// Helpers — kept module-local because both the service and the
// frontend formatter (in a separate file) need them, but the values
// are pre-formatted server-side so the frontend just renders the
// strings as-is.
// -------------------------------------------------------------------

function formatRand(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// Deep-link for an ADMIN_ACTION feed row. The old code naively built
// `/admin/<type>s/<id>` which 404'd for every resource without a detail
// page (e.g. a Setting change linked to /admin/settings/<key>). Only the
// four types with real [id] pages get a detail link; the rest map to
// their LIST page; anything unknown falls back to the audit log.
const ADMIN_DETAIL_ROUTES: Record<string, string> = {
  User: 'users',
  Listing: 'listings',
  Transaction: 'transactions',
  Order: 'orders',
};
const ADMIN_LIST_ROUTES: Record<string, string> = {
  Setting: 'settings',
  Deal: 'deals',
  Dealer: 'dealers',
  Supplier: 'suppliers',
  Category: 'categories',
  CategoryAttribute: 'categories',
  Broadcast: 'broadcast',
  AskGgKbEntry: 'ask-gg',
  AskGgGuideOverride: 'ask-gg',
  ManualLoad: 'reloading',
  ReloadingManual: 'reloading',
};
function adminActionHref(
  resourceType: string | null,
  resourceId: string | null,
): string {
  if (resourceType && resourceId && ADMIN_DETAIL_ROUTES[resourceType]) {
    return `/admin/${ADMIN_DETAIL_ROUTES[resourceType]}/${resourceId}`;
  }
  if (resourceType && ADMIN_LIST_ROUTES[resourceType]) {
    return `/admin/${ADMIN_LIST_ROUTES[resourceType]}`;
  }
  return '/admin/audit';
}

function formatType(t: string): string {
  if (t === 'BUY_NOW') return 'Buy Now';
  if (t === 'AUCTION') return 'Auction';
  if (t === 'TAKE_A_SHOT') return 'Take-a-Shot';
  return t;
}

// Return the UTC `Date` representing 00:00:00 in Africa/Johannesburg
// (UTC+2, no DST). For 02:00 UTC today, that's 04:00 SAST → SAST
// midnight was 2 hours ago UTC. For 23:00 UTC yesterday, SAST midnight
// is "today 22:00 UTC" — i.e. 1 hour ago.
function startOfTodaySast(): Date {
  // Current UTC instant.
  const nowUtc = new Date();
  // Shift forward by +2h to get the equivalent SAST clock instant.
  const sastNowMs = nowUtc.getTime() + 2 * 3600 * 1000;
  // Use that to compute SAST midnight in SAST-clock terms, then shift
  // back by -2h to get the UTC instant of SAST midnight.
  const sastNow = new Date(sastNowMs);
  const sastMidnightSastClock = Date.UTC(
    sastNow.getUTCFullYear(),
    sastNow.getUTCMonth(),
    sastNow.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return new Date(sastMidnightSastClock - 2 * 3600 * 1000);
}
