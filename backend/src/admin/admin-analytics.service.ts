import {
  queryFreshnessGraveyard,
  type FreshnessGraveyardRow,
} from './freshness-graveyard';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Admin analytics service — read-only aggregations over the existing
 * schema. No new tables. Powers the /admin/analytics dashboard.
 *
 * Conventions:
 *   - All currency values returned as ZAR cents (rendered as Rands on the
 *     frontend). Stays consistent with every other money endpoint.
 *   - "Sales" / GMV always means transactions in RELEASED state (payment
 *     captured + funds disbursed to the seller). PAYMENT_HELD is in-
 *     flight and could still refund, so we don't count it as revenue yet.
 *   - "Period" is a window ending at `now`. Comparisons (Δ %) compare
 *     against the equal-length window immediately before that — so for
 *     a 30d period the comparator is "the 30 days before that".
 */

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '365d' | 'all';
export type AnalyticsBucket = 'day' | 'week' | 'month';

// ── Insights (Phase 3) response shapes ──────────────────────────────
export interface InsightsPulse {
  dau: number;
  wau: number;
  mau: number;
  loginsToday: number;
  loginsWeek: number;
  activeListings: number;
  newUsers7d: number;
  salesWeek: number;
}
// dow: 0=Sun..6=Sat (Postgres EXTRACT(DOW)); hour: 0..23 (SA local time).
export interface HeatCell {
  dow: number;
  hour: number;
  value: number;
}
export interface SearchTerm {
  term: string;
  count: number;
  maxResults?: number;
}
export interface SearchIntel {
  topTerms: SearchTerm[];
  zeroResult: SearchTerm[];
}
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  users: number;
}
export interface ActiveUserRow {
  userId: string;
  username: string | null;
  events: number;
  lastSeen: string;
}
export interface UserDrilldown {
  userId: string;
  username: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  logins: { day: number; week: number; month: number; total: number };
  peakHours: { hour: number; value: number }[];
  totalsByType: { eventType: string; count: number }[];
  recent: {
    eventType: string;
    listingId: string | null;
    query: string | null;
    createdAt: string;
  }[];
}

export interface TimeSeriesPoint {
  bucket: string; // ISO date — day/week/month start
  gmvCents: number;
  revenueCents: number;
  txCount: number;
}

export interface OverviewKpis {
  gmvCents: number;
  gmvCentsPrev: number;
  revenueCents: number;
  revenueCentsPrev: number;
  txCount: number;
  txCountPrev: number;
  /**
   * ⚠️ NULL MEANS THE PERIOD HAD NOTHING TO MEASURE, NOT ZERO.
   *
   * An average over no orders is undefined, and a rate over a zero
   * denominator is undefined — but both used to be coerced to 0, so an empty
   * period reported "Avg order R0" and "Refund rate 0.0%" as if they were
   * findings. A refund rate of 0.0% is something a marketplace would be
   * pleased to see; printing it for a period with no sales is the Desk
   * stating something it never worked out. Null renders as an em dash.
   */
  aovCents: number | null;
  aovCentsPrev: number | null;
  refundRate: number | null; // 0..1, or null when nothing was sold
  refundRatePrev: number | null;
  disputeRate: number | null; // 0..1, or null when nothing was sold
  disputeRatePrev: number | null;
}

export interface ByListingType {
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  count: number;
  gmvCents: number;
}

export interface ByCategory {
  categoryName: string;
  count: number;
  gmvCents: number;
}

export interface KycFunnelStage {
  stage: string;
  count: number;
}

export interface DispatchSlaBucket {
  bucket: string;
  count: number;
}

export interface RefundRiskRow {
  sellerId: string;
  username: string | null;
  email: string;
  totalSales: number;
  refundCount: number;
  refundRate: number; // 0..1
  // Difference from marketplace baseline, in percentage points.
  // 5.0 = seller's refund rate is 5pp above the marketplace mean.
  ppDifference: number;
}

// The row shape and the query both live in ./freshness-graveyard, because
// the Desk ranks the same listings and the two must not drift apart.
export type { FreshnessGraveyardRow } from './freshness-graveyard';

export interface TopMakeModel {
  make: string;
  model: string;
  count: number;
  gmvCents: number;
  avgPriceCents: number;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Top-line KPIs with period-over-period deltas
  // -------------------------------------------------------------------
  async overview(period: AnalyticsPeriod): Promise<OverviewKpis> {
    const { from, to, prevFrom, prevTo } = this.periodRange(period);

    const [curr, prev] = await Promise.all([
      this.kpisForRange(from, to),
      this.kpisForRange(prevFrom, prevTo),
    ]);

    return {
      gmvCents: curr.gmvCents,
      gmvCentsPrev: prev.gmvCents,
      revenueCents: curr.revenueCents,
      revenueCentsPrev: prev.revenueCents,
      txCount: curr.txCount,
      txCountPrev: prev.txCount,
      aovCents: curr.aovCents,
      aovCentsPrev: prev.aovCents,
      refundRate: curr.refundRate,
      refundRatePrev: prev.refundRate,
      disputeRate: curr.disputeRate,
      disputeRatePrev: prev.disputeRate,
    };
  }

  // -------------------------------------------------------------------
  // Time-series: GMV, platform revenue, tx count over time
  // -------------------------------------------------------------------
  //
  // Uses date_trunc so the bucket is timezone-aware (uses the DB's
  // timezone — which we assume is UTC; that's fine for SA daily charts,
  // there's no DST issue). Bucket sizes:
  //   day   — date_trunc('day',   releasedAt)
  //   week  — date_trunc('week',  releasedAt) — ISO week, Monday start
  //   month — date_trunc('month', releasedAt)
  //
  // We use releasedAt (when funds disburse) rather than paidAt (when
  // checkout completes) so a sale only "counts" once it's actually
  // platform revenue — refunds/disputes during HELD never inflate the
  // chart only to retract later.
  async timeSeries(
    period: AnalyticsPeriod,
    bucket: AnalyticsBucket,
  ): Promise<TimeSeriesPoint[]> {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.$queryRawUnsafe<
      { bucket: Date; gmv: bigint | number; revenue: bigint | number; count: bigint | number }[]
    >(
      `
      SELECT
        date_trunc($1, "releasedAt") AS bucket,
        COALESCE(SUM("buyerTotal"), 0)    AS gmv,
        COALESCE(SUM("commissionZar"), 0) AS revenue,
        COUNT(*)                          AS count
      FROM "Transaction"
      WHERE "paymentStatus" = 'RELEASED'
        AND "releasedAt" >= $2
        AND "releasedAt" <  $3
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      bucket,
      from,
      to,
    );

    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      gmvCents: Number(r.gmv),
      revenueCents: Number(r.revenue),
      txCount: Number(r.count),
    }));
  }

  // -------------------------------------------------------------------
  // Sales split by listing type — donut chart input
  // -------------------------------------------------------------------
  async byListingType(period: AnalyticsPeriod): Promise<ByListingType[]> {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.$queryRawUnsafe<
      { listingType: string; count: bigint | number; gmv: bigint | number }[]
    >(
      `
      SELECT
        l."listingType",
        COUNT(*)                        AS count,
        COALESCE(SUM(t."buyerTotal"),0) AS gmv
      FROM "Transaction" t
      JOIN "Listing" l ON l.id = t."listingId"
      WHERE t."paymentStatus" = 'RELEASED'
        AND t."releasedAt" >= $1
        AND t."releasedAt" <  $2
      GROUP BY l."listingType"
      ORDER BY count DESC
      `,
      from,
      to,
    );

    return rows.map((r) => ({
      listingType: r.listingType as ByListingType['listingType'],
      count: Number(r.count),
      gmvCents: Number(r.gmv),
    }));
  }

  // -------------------------------------------------------------------
  // Sales split by category — bar chart input
  // -------------------------------------------------------------------
  async byCategory(period: AnalyticsPeriod, limit = 10): Promise<ByCategory[]> {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.$queryRawUnsafe<
      { categoryName: string; count: bigint | number; gmv: bigint | number }[]
    >(
      `
      SELECT
        c.name AS "categoryName",
        COUNT(*) AS count,
        COALESCE(SUM(t."buyerTotal"),0) AS gmv
      FROM "Transaction" t
      JOIN "Listing"  l ON l.id = t."listingId"
      JOIN "Category" c ON c.id = l."categoryId"
      WHERE t."paymentStatus" = 'RELEASED'
        AND t."releasedAt" >= $1
        AND t."releasedAt" <  $2
      GROUP BY c.name
      ORDER BY gmv DESC
      LIMIT $3
      `,
      from,
      to,
      limit,
    );

    return rows.map((r) => ({
      categoryName: r.categoryName,
      count: Number(r.count),
      gmvCents: Number(r.gmv),
    }));
  }

  // -------------------------------------------------------------------
  // Top makes + models — informs the public "price index" feature
  // -------------------------------------------------------------------
  // Filters out NULL/empty makes (categories like accessories often
  // don't have a structured make/model). Groups case-insensitively.
  async topMakeModel(period: AnalyticsPeriod, limit = 15): Promise<TopMakeModel[]> {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.$queryRawUnsafe<
      {
        make: string;
        model: string;
        count: bigint | number;
        gmv: bigint | number;
        avgPrice: bigint | number;
      }[]
    >(
      `
      SELECT
        l.make,
        l.model,
        COUNT(*) AS count,
        COALESCE(SUM(t."buyerTotal"),0) AS gmv,
        COALESCE(AVG(t."buyerTotal"),0) AS "avgPrice"
      FROM "Transaction" t
      JOIN "Listing" l ON l.id = t."listingId"
      WHERE t."paymentStatus" = 'RELEASED'
        AND t."releasedAt" >= $1
        AND t."releasedAt" <  $2
        AND l.make  IS NOT NULL AND l.make  <> ''
        AND l.model IS NOT NULL AND l.model <> ''
      GROUP BY l.make, l.model
      ORDER BY count DESC, gmv DESC
      LIMIT $3
      `,
      from,
      to,
      limit,
    );

    return rows.map((r) => ({
      make: r.make,
      model: r.model,
      count: Number(r.count),
      gmvCents: Number(r.gmv),
      avgPriceCents: Math.round(Number(r.avgPrice)),
    }));
  }

  // -------------------------------------------------------------------
  // Operational Health — three signals for the seller-side funnel +
  // shipping flow + refund risk.
  // -------------------------------------------------------------------

  // KYC funnel — how many users sit at each stage. Drop-offs between
  // adjacent stages tell you where the friction is (e.g. big drop
  // between consent → ID verified means VerifyNow ID lookup is failing
  // a lot; big drop between ID → face means selfie UX is broken).
  async kycFunnel(): Promise<KycFunnelStage[]> {
    const [required, consented, idVerified, faceAttempted, verified] = await Promise.all([
      this.prisma.user.count({ where: { kycRequiredAt: { not: null } } }),
      this.prisma.user.count({ where: { kycConsentGivenAt: { not: null } } }),
      this.prisma.user.count({ where: { kycIdVerifiedAt: { not: null } } }),
      this.prisma.user.count({ where: { kycAttempts: { gt: 0 } } }),
      this.prisma.user.count({ where: { kycStatus: 'VERIFIED' } }),
    ]);
    return [
      { stage: 'KYC required', count: required },
      { stage: 'Consent given', count: consented },
      { stage: 'ID verified', count: idVerified },
      { stage: 'Selfie attempted', count: faceAttempted },
      { stage: 'Fully verified', count: verified },
    ];
  }

  // Dispatch SLA histogram — paid → dispatched hours, bucketed:
  //   < 24h | 24-48h | 48-72h | breached (> 72h or never)
  // Counts transactions that went past PAID into either dispatched or
  // still-undispatched-and-old buckets.
  async dispatchSlaDistribution(): Promise<DispatchSlaBucket[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      { bucket: string; count: bigint | number }[]
    >(
      `
      SELECT bucket, COUNT(*)::int AS count
      FROM (
        SELECT
          CASE
            WHEN "dispatchedAt" IS NULL AND "paidAt" < NOW() - INTERVAL '72 hours' THEN 'breached'
            WHEN "dispatchedAt" IS NULL THEN 'pending'
            WHEN EXTRACT(EPOCH FROM ("dispatchedAt" - "paidAt"))/3600 < 24 THEN 'under-24h'
            WHEN EXTRACT(EPOCH FROM ("dispatchedAt" - "paidAt"))/3600 < 48 THEN '24-48h'
            WHEN EXTRACT(EPOCH FROM ("dispatchedAt" - "paidAt"))/3600 < 72 THEN '48-72h'
            ELSE 'breached'
          END AS bucket
        FROM "Transaction"
        WHERE "paidAt" IS NOT NULL
          AND "shippingMethod" IN ('PUDO', 'TCG', 'DEALER_TRANSFER')
      ) t
      GROUP BY bucket
      `,
    );
    const order = ['under-24h', '24-48h', '48-72h', 'pending', 'breached'];
    const lookup = new Map(rows.map((r) => [r.bucket, Number(r.count)]));
    return order.map((b) => ({ bucket: b, count: lookup.get(b) ?? 0 }));
  }

  // Refund risk — sellers with refund rate ≥ 2x marketplace baseline.
  // We compute the marketplace baseline (total refunded / total
  // released+refunded) then list every seller whose own rate is at
  // least 2x AND who has ≥3 total transactions (filter noise).
  async refundRiskSellers(): Promise<RefundRiskRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        sellerId: string;
        username: string | null;
        email: string;
        totalSales: bigint | number;
        refundCount: bigint | number;
        refundRate: number;
      }[]
    >(
      `
      WITH baseline AS (
        SELECT
          COUNT(*) FILTER (WHERE "paymentStatus" = 'REFUNDED')::float
            / NULLIF(COUNT(*) FILTER (WHERE "paymentStatus" IN ('REFUNDED', 'RELEASED')), 0) AS rate
        FROM "Transaction"
        WHERE "swapId" IS NULL
      )
      SELECT
        u.id AS "sellerId",
        u.username,
        u.email,
        COUNT(t.*)::int AS "totalSales",
        COUNT(t.*) FILTER (WHERE t."paymentStatus" = 'REFUNDED')::int AS "refundCount",
        (COUNT(t.*) FILTER (WHERE t."paymentStatus" = 'REFUNDED')::float
          / NULLIF(COUNT(t.*), 0))::float AS "refundRate"
      FROM "User" u
      JOIN "Transaction" t ON t."sellerId" = u.id
      WHERE t."paymentStatus" IN ('REFUNDED', 'RELEASED')
        AND t."swapId" IS NULL
      GROUP BY u.id, u.username, u.email
      HAVING COUNT(t.*) >= 3
         AND (COUNT(t.*) FILTER (WHERE t."paymentStatus" = 'REFUNDED')::float
              / NULLIF(COUNT(t.*), 0))
             >= 2 * (SELECT rate FROM baseline)
         AND (SELECT rate FROM baseline) > 0
      ORDER BY "refundRate" DESC
      LIMIT 30
      `,
    );

    // Compute marketplace baseline for the pp-difference column.
    const baseline = await this.prisma.$queryRawUnsafe<{ rate: number | null }[]>(
      `SELECT
         COUNT(*) FILTER (WHERE "paymentStatus" = 'REFUNDED')::float
           / NULLIF(COUNT(*) FILTER (WHERE "paymentStatus" IN ('REFUNDED', 'RELEASED')), 0) AS rate
       FROM "Transaction"
       WHERE "swapId" IS NULL`,
    );
    const baselineRate = Number(baseline[0]?.rate ?? 0);

    return rows.map((r) => ({
      sellerId: r.sellerId,
      username: r.username,
      email: r.email,
      totalSales: Number(r.totalSales),
      refundCount: Number(r.refundCount),
      refundRate: Number(r.refundRate),
      ppDifference: (Number(r.refundRate) - baselineRate) * 100,
    }));
  }

  // -------------------------------------------------------------------
  // Freshness graveyard — ACTIVE listings older than `minAgeDays` with
  // zero engagement (no bids, no offers, no watchers). Ranked by a
  // staleScore = ageDays × priceRand so high-value old inventory floats
  // to the top. Operator nudges the seller or takes it down.
  // -------------------------------------------------------------------
  async freshnessGraveyard(
    minAgeDays = 30,
    limit = 50,
  ): Promise<FreshnessGraveyardRow[]> {
    return queryFreshnessGraveyard(this.prisma, { minAgeDays, limit });
  }

  // -------------------------------------------------------------------
  // Median time-to-sale by category — informational table
  // -------------------------------------------------------------------
  //
  // Uses percentile_cont(0.5) — Postgres-native median. We only count
  // listings that actually sold (soldAt IS NOT NULL); the alternative
  // (mean) is dragged by a few stale listings sitting active for 60
  // days, so median is the honest number.
  async timeToSale(period: AnalyticsPeriod): Promise<
    { categoryName: string; medianDays: number; sold: number }[]
  > {
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.$queryRawUnsafe<
      { categoryName: string; medianDays: number; sold: bigint | number }[]
    >(
      `
      SELECT
        c.name AS "categoryName",
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (l."soldAt" - l."createdAt"))/86400
        )::float AS "medianDays",
        COUNT(*) AS sold
      FROM "Listing" l
      JOIN "Category" c ON c.id = l."categoryId"
      WHERE l."soldAt" IS NOT NULL
        AND l."soldAt" >= $1
        AND l."soldAt" <  $2
      GROUP BY c.name
      HAVING COUNT(*) >= 3
      ORDER BY sold DESC
      LIMIT 10
      `,
      from,
      to,
    );

    return rows.map((r) => ({
      categoryName: r.categoryName,
      medianDays: Math.round(Number(r.medianDays) * 10) / 10,
      sold: Number(r.sold),
    }));
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  // Resolve a period token to (current window, previous window). The
  // previous window is always the same length as the current, ending
  // exactly when the current begins — so 30d compares to "the 30 days
  // before that". "all" has no comparator (we return a zero-length
  // previous range so all KPIs prev show 0).
  private periodRange(period: AnalyticsPeriod) {
    const now = new Date();
    const to = now;
    let days: number;
    switch (period) {
      case '7d':
        days = 7;
        break;
      case '30d':
        days = 30;
        break;
      case '90d':
        days = 90;
        break;
      case '365d':
        days = 365;
        break;
      case 'all':
      default:
        // Earliest plausible row — we just pull everything.
        return {
          from: new Date(0),
          to,
          prevFrom: new Date(0),
          prevTo: new Date(0),
        };
    }
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const prevTo = from;
    const prevFrom = new Date(prevTo.getTime() - days * 24 * 3600 * 1000);
    return { from, to, prevFrom, prevTo };
  }

  // Pull the four headline numbers for an arbitrary date range. Used
  // once for the current window and once for the previous window so the
  // dashboard can render Δ %.
  private async kpisForRange(from: Date, to: Date) {
    const [released, refunded, disputed] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          paymentStatus: 'RELEASED',
          releasedAt: { gte: from, lt: to },
        },
        _sum: { buyerTotal: true, commissionZar: true },
        _count: true,
        _avg: { buyerTotal: true },
      }),
      this.prisma.transaction.count({
        where: {
          paymentStatus: 'REFUNDED',
          // exclude synthetic refund-slice children (P0.3) — a full refund
          // would otherwise count parent + child as two refunds.
          refundOfId: null,
          updatedAt: { gte: from, lt: to },
        },
      }),
      this.prisma.transaction.count({
        where: {
          paymentStatus: 'DISPUTED',
          updatedAt: { gte: from, lt: to },
        },
      }),
    ]);

    const total = await this.prisma.transaction.count({
      where: { createdAt: { gte: from, lt: to }, refundOfId: null },
    });

    return {
      gmvCents: released._sum.buyerTotal ?? 0,
      revenueCents: released._sum.commissionZar ?? 0,
      txCount: released._count,
      // `_avg` is null when the period matched no rows — that is "no
      // orders", not "the average was nought". Same for the two rates: the
      // divide-by-zero guard was already here, it just answered 0.
      aovCents: released._count === 0 ? null : Math.round(released._avg.buyerTotal ?? 0),
      refundRate: total > 0 ? refunded / total : null,
      disputeRate: total > 0 ? disputed / total : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // Insights (Phase 3) — behavioural + login analytics on top of the
  // UserEvent / LoginEvent / *Stats tables. Hours are converted to SA
  // local time (releasedAt/createdAt are stored naive-UTC) so the "peak
  // time" heatmaps read in the operator's clock.
  // ══════════════════════════════════════════════════════════════════
  private readonly TZ = "AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Johannesburg'";

  private async distinctActors(since: Date): Promise<number> {
    const r = await this.prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(DISTINCT COALESCE("userId", "clerkId", "deviceId")) AS c
      FROM "UserEvent" WHERE "createdAt" >= ${since}`;
    return Number(r[0]?.c ?? 0);
  }

  async insightsPulse(): Promise<InsightsPulse> {
    const now = Date.now();
    const d1 = new Date(now - 1 * 86400000);
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      dau,
      wau,
      mau,
      loginsToday,
      loginsWeek,
      activeListings,
      newUsers7d,
      salesWeek,
    ] = await Promise.all([
      this.distinctActors(d1),
      this.distinctActors(d7),
      this.distinctActors(d30),
      this.prisma.loginEvent.count({ where: { startedAt: { gte: startOfToday } } }),
      this.prisma.loginEvent.count({ where: { startedAt: { gte: d7 } } }),
      this.prisma.listing.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.transaction.count({
        where: { paymentStatus: 'RELEASED', releasedAt: { gte: d7 } },
      }),
    ]);
    return {
      dau,
      wau,
      mau,
      loginsToday,
      loginsWeek,
      activeListings,
      newUsers7d,
      salesWeek,
    };
  }

  // When do sales complete? dow × hour from released transactions.
  async salesHeatmap(period: AnalyticsPeriod): Promise<HeatCell[]> {
    const { from, to } = this.periodRange(period);
    const rows = await this.prisma.$queryRawUnsafe<
      { dow: number; hour: number; c: bigint }[]
    >(
      `SELECT EXTRACT(DOW FROM ("releasedAt" ${this.TZ}))::int AS dow,
              EXTRACT(HOUR FROM ("releasedAt" ${this.TZ}))::int AS hour,
              COUNT(*) AS c
       FROM "Transaction"
       WHERE "paymentStatus" = 'RELEASED' AND "releasedAt" >= $1 AND "releasedAt" < $2
       GROUP BY 1, 2`,
      from,
      to,
    );
    return rows.map((r) => ({
      dow: Number(r.dow),
      hour: Number(r.hour),
      value: Number(r.c),
    }));
  }

  // When are users active? dow × hour from raw events.
  async activityHeatmap(period: AnalyticsPeriod): Promise<HeatCell[]> {
    const { from, to } = this.periodRange(period);
    const rows = await this.prisma.$queryRawUnsafe<
      { dow: number; hour: number; c: bigint }[]
    >(
      `SELECT EXTRACT(DOW FROM ("createdAt" ${this.TZ}))::int AS dow,
              EXTRACT(HOUR FROM ("createdAt" ${this.TZ}))::int AS hour,
              COUNT(*) AS c
       FROM "UserEvent"
       WHERE "createdAt" >= $1 AND "createdAt" < $2
       GROUP BY 1, 2`,
      from,
      to,
    );
    return rows.map((r) => ({
      dow: Number(r.dow),
      hour: Number(r.hour),
      value: Number(r.c),
    }));
  }

  // Search intelligence — what people look for, and what returns nothing.
  async searchIntel(period: AnalyticsPeriod): Promise<SearchIntel> {
    const { from, to } = this.periodRange(period);
    const [topTerms, zeroResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        { term: string; c: bigint; maxres: number | null }[]
      >(
        `SELECT lower(query) AS term, COUNT(*) AS c, MAX("resultCount") AS maxres
         FROM "UserEvent"
         WHERE "eventType" = 'search' AND query IS NOT NULL AND query <> ''
           AND "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY 1 ORDER BY c DESC LIMIT 20`,
        from,
        to,
      ),
      this.prisma.$queryRawUnsafe<{ term: string; c: bigint }[]>(
        `SELECT lower(query) AS term, COUNT(*) AS c
         FROM "UserEvent"
         WHERE "eventType" = 'search' AND "resultCount" = 0 AND query IS NOT NULL AND query <> ''
           AND "createdAt" >= $1 AND "createdAt" < $2
         GROUP BY 1 ORDER BY c DESC LIMIT 15`,
        from,
        to,
      ),
    ]);
    return {
      topTerms: topTerms.map((r) => ({
        term: r.term,
        count: Number(r.c),
        maxResults: r.maxres ?? 0,
      })),
      zeroResult: zeroResult.map((r) => ({ term: r.term, count: Number(r.c) })),
    };
  }

  // Engagement funnel — view → save → offer/bid → checkout → paid.
  async engagementFunnel(period: AnalyticsPeriod): Promise<FunnelStage[]> {
    const { from, to } = this.periodRange(period);
    const rows = await this.prisma.$queryRawUnsafe<
      { eventType: string; c: bigint; u: bigint }[]
    >(
      `SELECT "eventType", COUNT(*) AS c,
              COUNT(DISTINCT COALESCE("userId","clerkId","deviceId")) AS u
       FROM "UserEvent"
       WHERE "createdAt" >= $1 AND "createdAt" < $2
       GROUP BY 1`,
      from,
      to,
    );
    const by = new Map(rows.map((r) => [r.eventType, r]));
    const paid = await this.prisma.transaction.count({
      where: { paidAt: { gte: from, lt: to } },
    });
    const stage = (key: string, label: string): FunnelStage => {
      const r = by.get(key);
      return { key, label, count: Number(r?.c ?? 0), users: Number(r?.u ?? 0) };
    };
    const saveOffer = stage('wishlist_add', 'Saved / offered');
    const offer = by.get('offer_placed');
    const bid = by.get('bid_placed');
    const cart = by.get('cart_add');
    return [
      stage('listing_view', 'Viewed a listing'),
      {
        key: 'intent',
        label: 'Saved · offered · bid · carted',
        count:
          Number(saveOffer.count) +
          Number(offer?.c ?? 0) +
          Number(bid?.c ?? 0) +
          Number(cart?.c ?? 0),
        users:
          Number(saveOffer.users) +
          Number(offer?.u ?? 0) +
          Number(bid?.u ?? 0) +
          Number(cart?.u ?? 0),
      },
      stage('checkout_started', 'Started checkout'),
      { key: 'paid', label: 'Paid', count: paid, users: paid },
    ];
  }

  // Most active users in the window — the drilldown list.
  async topActiveUsers(
    period: AnalyticsPeriod,
    limit = 25,
  ): Promise<ActiveUserRow[]> {
    const { from, to } = this.periodRange(period);
    const rows = await this.prisma.$queryRawUnsafe<
      { userId: string; username: string | null; events: bigint; lastseen: Date }[]
    >(
      `SELECT ue."userId", u.username, COUNT(*) AS events, MAX(ue."createdAt") AS lastseen
       FROM "UserEvent" ue JOIN "User" u ON u.id = ue."userId"
       WHERE ue."userId" IS NOT NULL AND ue."createdAt" >= $1 AND ue."createdAt" < $2
       GROUP BY 1, 2 ORDER BY events DESC LIMIT $3`,
      from,
      to,
      limit,
    );
    return rows.map((r) => ({
      userId: r.userId,
      username: r.username,
      events: Number(r.events),
      lastSeen: r.lastseen.toISOString(),
    }));
  }

  // Everything about one user — the "big brother" drilldown.
  async userDrilldown(userId: string): Promise<UserDrilldown | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!user) return null;

    const now = Date.now();
    const d1 = new Date(now - 1 * 86400000);
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);

    const [loginDay, loginWeek, loginMonth, loginTotal, peak, totals, recent] =
      await Promise.all([
        this.prisma.loginEvent.count({
          where: { userId, startedAt: { gte: d1 } },
        }),
        this.prisma.loginEvent.count({
          where: { userId, startedAt: { gte: d7 } },
        }),
        this.prisma.loginEvent.count({
          where: { userId, startedAt: { gte: d30 } },
        }),
        this.prisma.loginEvent.count({ where: { userId } }),
        this.prisma.$queryRawUnsafe<{ hour: number; c: bigint }[]>(
          `SELECT EXTRACT(HOUR FROM ("createdAt" ${this.TZ}))::int AS hour, COUNT(*) AS c
           FROM "UserEvent" WHERE "userId" = $1 GROUP BY 1 ORDER BY 1`,
          userId,
        ),
        this.prisma.$queryRawUnsafe<{ eventType: string; c: bigint }[]>(
          `SELECT "eventType", COUNT(*) AS c FROM "UserEvent" WHERE "userId" = $1 GROUP BY 1 ORDER BY c DESC`,
          userId,
        ),
        this.prisma.userEvent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: {
            eventType: true,
            listingId: true,
            query: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      userId: user.id,
      username: user.username,
      createdAt: user.createdAt?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      logins: {
        day: loginDay,
        week: loginWeek,
        month: loginMonth,
        total: loginTotal,
      },
      peakHours: peak.map((r) => ({ hour: Number(r.hour), value: Number(r.c) })),
      totalsByType: totals.map((r) => ({
        eventType: r.eventType,
        count: Number(r.c),
      })),
      recent: recent.map((r) => ({
        eventType: r.eventType,
        listingId: r.listingId,
        query: r.query,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // Dormant re-engagement segment size — total with a marketing opt-in, and
  // the subset reachable by SMS (verified phone, SMS on). Mirrors the
  // AdminBroadcastService 'dormant' audience so the insights CTA shows the
  // true reachable count before the operator opens the composer.
  async dormantSegment(): Promise<{ total: number; smsReachable: number }> {
    const d14 = new Date(Date.now() - 14 * 86400000);
    const base = {
      isBanned: false,
      marketingConsentAt: { not: null },
      createdAt: { lt: d14 },
      OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: d14 } }],
    };
    const [total, smsReachable] = await Promise.all([
      this.prisma.user.count({ where: base }),
      this.prisma.user.count({
        where: {
          ...base,
          phone: { not: null },
          phoneVerified: true,
          notifySmsEnabled: true,
        },
      }),
    ]);
    return { total, smsReachable };
  }
}
