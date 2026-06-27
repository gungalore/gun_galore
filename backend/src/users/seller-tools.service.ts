import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../common/csv.util';

// Seller self-service tools (Phase 6): payout statement + analytics.
// Read-only aggregations over the existing schema scoped to the signed-in
// seller. Mirrors the conventions of AdminAnalyticsService:
//   - money in ZAR cents
//   - "earnings"/sales = transactions in RELEASED state (funds disbursed)
//   - releasedAt is the revenue clock (a HELD order can still refund)

export type SellerPeriod = '7d' | '30d' | '90d' | '365d' | 'all';

function rand(cents: number): string {
  return (
    'R' +
    (cents / 100).toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function periodDays(period: SellerPeriod): number | null {
  switch (period) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '365d':
      return 365;
    case 'all':
    default:
      return null;
  }
}

@Injectable()
export class SellerToolsService {
  constructor(private readonly prisma: PrismaService) {}

  private async sellerId(clerkId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.id;
  }

  // ------------------------------------------------------------------
  // Payout statement — per-order earnings breakdown + totals (P6.1)
  // ------------------------------------------------------------------
  // Default window: last 90 days. Earnings totals count RELEASED orders
  // only; REFUNDED rows appear in the detail (greyed) but never inflate
  // the total. Timestamps are returned in UTC ISO — the frontend labels
  // the period; we don't TZ-convert here.
  async payoutStatement(
    clerkId: string,
    fromISO?: string,
    toISO?: string,
  ) {
    const sellerId = await this.sellerId(clerkId);

    const to = toISO ? new Date(toISO) : new Date();
    const from = fromISO
      ? new Date(fromISO)
      : new Date(to.getTime() - 90 * 24 * 3600 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must be before "to"');
    }

    // RELEASED orders in the window (by releasedAt) + REFUNDED in the
    // window (by updatedAt) for the detail table. We fetch both and tag.
    const rows = await this.prisma.transaction.findMany({
      where: {
        sellerId,
        OR: [
          { paymentStatus: 'RELEASED', releasedAt: { gte: from, lte: to } },
          { paymentStatus: 'REFUNDED', updatedAt: { gte: from, lte: to } },
        ],
      },
      select: {
        id: true,
        orderReference: true,
        createdAt: true,
        releasedAt: true,
        paymentStatus: true,
        listingPrice: true,
        commissionZar: true,
        processingFee: true,
        shippingCost: true,
        sellerPayout: true,
        buyerTotal: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true } },
      },
      orderBy: { releasedAt: 'desc' },
    });

    const released = rows.filter((r) => r.paymentStatus === 'RELEASED');
    const summary = {
      orderCount: released.length,
      grossSales: released.reduce((s, r) => s + r.listingPrice, 0),
      totalCommission: released.reduce((s, r) => s + r.commissionZar, 0),
      totalProcessingFees: released.reduce((s, r) => s + r.processingFee, 0),
      totalShipping: released.reduce((s, r) => s + r.shippingCost, 0),
      netPayout: released.reduce((s, r) => s + r.sellerPayout, 0),
      refundedCount: rows.length - released.length,
    };

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      summary,
      orders: rows.map((r) => ({
        id: r.id,
        reference: r.orderReference,
        date: (r.releasedAt ?? r.createdAt).toISOString(),
        listingTitle: r.listing.title,
        buyerUsername: r.buyer.username,
        status: r.paymentStatus,
        listingPrice: r.listingPrice,
        commission: r.commissionZar,
        processingFee: r.processingFee,
        shipping: r.shippingCost,
        netPayout: r.sellerPayout,
      })),
    };
  }

  // CSV of the same statement — one row per order + a TOTAL line.
  async payoutStatementCsv(
    clerkId: string,
    fromISO?: string,
    toISO?: string,
  ): Promise<string> {
    const stmt = await this.payoutStatement(clerkId, fromISO, toISO);
    const header = [
      'Reference',
      'Date',
      'Item',
      'Buyer',
      'Status',
      'Item price',
      'Commission',
      'Processing fee',
      'Shipping',
      'Net payout',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const o of stmt.orders) {
      lines.push(
        [
          o.reference ?? o.id.slice(-8).toUpperCase(),
          o.date.slice(0, 10),
          o.listingTitle,
          o.buyerUsername ?? '',
          o.status,
          rand(o.listingPrice),
          rand(o.commission),
          rand(o.processingFee),
          rand(o.shipping),
          rand(o.netPayout),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    lines.push(
      ['TOTAL', '', '', '', `${stmt.summary.orderCount} orders`, rand(stmt.summary.grossSales), rand(stmt.summary.totalCommission), rand(stmt.summary.totalProcessingFees), rand(stmt.summary.totalShipping), rand(stmt.summary.netPayout)]
        .map(csvCell)
        .join(','),
    );
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------------
  // Seller analytics (P6.4) — KPIs + revenue time-series, seller-scoped.
  // NOTE: listing view-count is NOT tracked anywhere in the schema, so we
  // deliberately DO NOT report views or a view→sale conversion rate. We
  // report what's real: released sales, revenue, AOV, and a sales/active
  // listing count. (Documented limitation, not an omission.)
  // ------------------------------------------------------------------
  async analytics(clerkId: string, period: SellerPeriod) {
    const sellerId = await this.sellerId(clerkId);
    const days = periodDays(period);
    const to = new Date();
    const from = days ? new Date(to.getTime() - days * 24 * 3600 * 1000) : new Date(0);

    const [agg, activeListings, soldListings, series] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { sellerId, paymentStatus: 'RELEASED', releasedAt: { gte: from, lte: to } },
        _sum: { buyerTotal: true, sellerPayout: true },
        _count: true,
        _avg: { buyerTotal: true },
      }),
      this.prisma.listing.count({ where: { sellerId, status: 'ACTIVE' } }),
      this.prisma.listing.count({ where: { sellerId, status: 'SOLD' } }),
      this.prisma.$queryRawUnsafe<
        { bucket: Date; gmv: bigint | number; payout: bigint | number; count: bigint | number }[]
      >(
        `
        SELECT date_trunc('day', "releasedAt") AS bucket,
               COALESCE(SUM("buyerTotal"), 0)   AS gmv,
               COALESCE(SUM("sellerPayout"), 0) AS payout,
               COUNT(*)                         AS count
        FROM "Transaction"
        WHERE "sellerId" = $1
          AND "paymentStatus" = 'RELEASED'
          AND "releasedAt" >= $2
          AND "releasedAt" <= $3
        GROUP BY 1 ORDER BY 1 ASC
        `,
        sellerId,
        from,
        to,
      ),
    ]);

    return {
      period,
      kpis: {
        salesCount: agg._count,
        grossSalesCents: agg._sum.buyerTotal ?? 0,
        netPayoutCents: agg._sum.sellerPayout ?? 0,
        avgOrderValueCents: Math.round(agg._avg.buyerTotal ?? 0),
        activeListings,
        soldListings,
      },
      timeSeries: series.map((r) => ({
        bucket: r.bucket.toISOString(),
        gmvCents: Number(r.gmv),
        payoutCents: Number(r.payout),
        salesCount: Number(r.count),
      })),
      // Surfaced so the UI can honestly explain the missing metric.
      notes: { viewTracking: false },
    };
  }
}
