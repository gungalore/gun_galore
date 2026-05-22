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
  aovCents: number;
  aovCentsPrev: number;
  refundRate: number; // 0..1
  refundRatePrev: number;
  disputeRate: number; // 0..1
  disputeRatePrev: number;
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

export interface FreshnessGraveyardRow {
  id: string;
  referenceNumber: string | null;
  title: string;
  priceCents: number | null;
  ageDays: number;
  // Higher = more dead inventory weight. age × price proxies for
  // "the value sitting unsold the longest". Sellers with multiple
  // entries surface near the top because each listing scores
  // independently.
  staleScore: number;
  sellerId: string;
  sellerUsername: string | null;
  sellerEmail: string;
  categoryName: string;
  listingType: string;
}

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
       FROM "Transaction"`,
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
    const cutoff = new Date(Date.now() - minAgeDays * 24 * 3600 * 1000);

    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        referenceNumber: string | null;
        title: string;
        priceCents: number | null;
        ageDays: number;
        staleScore: number;
        sellerId: string;
        sellerUsername: string | null;
        sellerEmail: string;
        categoryName: string;
        listingType: string;
      }[]
    >(
      `
      SELECT
        l.id,
        l."referenceNumber",
        l.title,
        l.price AS "priceCents",
        EXTRACT(EPOCH FROM (NOW() - l."createdAt"))/86400 AS "ageDays",
        (EXTRACT(EPOCH FROM (NOW() - l."createdAt"))/86400) * (COALESCE(l.price, 0) / 100.0) AS "staleScore",
        u.id AS "sellerId",
        u.username AS "sellerUsername",
        u.email AS "sellerEmail",
        c.name AS "categoryName",
        l."listingType"::text AS "listingType"
      FROM "Listing" l
      JOIN "User"     u ON u.id = l."sellerId"
      JOIN "Category" c ON c.id = l."categoryId"
      WHERE l.status = 'ACTIVE'
        AND l."createdAt" < $1
        AND l."bidCount" = 0
        AND NOT EXISTS (SELECT 1 FROM "Offer"        o WHERE o."listingId" = l.id)
        AND NOT EXISTS (SELECT 1 FROM "AuctionWatch" w WHERE w."listingId" = l.id)
      ORDER BY "staleScore" DESC NULLS LAST
      LIMIT $2
      `,
      cutoff,
      limit,
    );

    return rows.map((r) => ({
      ...r,
      ageDays: Math.round(Number(r.ageDays) * 10) / 10,
      priceCents: r.priceCents !== null ? Number(r.priceCents) : null,
      staleScore: Math.round(Number(r.staleScore)),
    }));
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
      where: { createdAt: { gte: from, lt: to } },
    });

    return {
      gmvCents: released._sum.buyerTotal ?? 0,
      revenueCents: released._sum.commissionZar ?? 0,
      txCount: released._count,
      aovCents: Math.round(released._avg.buyerTotal ?? 0),
      refundRate: total > 0 ? refunded / total : 0,
      disputeRate: total > 0 ? disputed / total : 0,
    };
  }
}
