import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../common/csv.util';
import {
  sellerBreakdown,
  type SellerBreakdown,
} from '../payments/fee-presentation';

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
  private readonly logger = new Logger(SellerToolsService.name);

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
        swapId: null, // exclude synthetic SWOP settlement/refund txs (S5)
        refundOfId: null, // exclude synthetic refund-slice children (P0.3)
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
        shippingHandlingCents: true,
        sellerPayout: true,
        buyerTotal: true,
        passFeeToBuyer: true,
        feeModel: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true } },
      },
      orderBy: { releasedAt: 'desc' },
    });

    // ⚠️ COMMISSION IS NOT ALWAYS A DEDUCTION. Under BUYNOW_MARKUP our cut
    // was added to the BUYER's price; the seller was never charged it and
    // receives their full ask. This statement billed commissionZar and
    // processingFee as seller deductions unconditionally — right for an
    // auction, a fiction for every marked-up Buy Now, and the CSV's TOTAL row
    // did not subtract to the payout it printed. sellerBreakdown() returns the
    // deductions that actually happened, and guarantees gross − deductions =
    // net for both models.
    const priced = rows.map((r) => ({ r, b: sellerBreakdown(r) }));
    // ⚠️ HONOUR THE CONTRACT THE BUILDER OFFERS. Every other caller checks
    // `balances`; this one rendered rows and a TOTAL line regardless, so a row
    // whose columns do not subtract (a CPA-cancelled experience deliberately
    // stores a partial payout that is not price − commission) would print a
    // statement that quietly does not add up. Surfaced, never hidden.
    for (const p of priced) {
      if (!p.b.balances) {
        this.logger.warn(
          `Statement row ${p.r.id}: ${p.b.gross} − deductions ≠ ${p.b.net} (fee model ${p.r.feeModel}) — shown as stored`,
        );
      }
    }
    const ded = (b: SellerBreakdown, label: string) =>
      b.deductions.find((d) => d.label === label)?.cents ?? 0;

    const released = priced.filter((p) => p.r.paymentStatus === 'RELEASED');
    const summary = {
      orderCount: released.length,
      // The seller's own gross — their ask under the markup model, the sale
      // price under the deduct model. NOT the marked-up number the buyer saw.
      grossSales: released.reduce((s, p) => s + p.b.gross, 0),
      totalCommission: released.reduce(
        (s, p) => s + ded(p.b, 'Commission'),
        0,
      ),
      totalProcessingFees: released.reduce(
        (s, p) => s + ded(p.b, 'Payment processing fee'),
        0,
      ),
      totalShipping: released.reduce((s, p) => s + p.r.shippingCost, 0),
      netPayout: released.reduce((s, p) => s + p.b.net, 0),
      refundedCount: rows.length - released.length,
    };

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      summary,
      orders: priced.map(({ r, b }) => ({
        id: r.id,
        reference: r.orderReference,
        date: (r.releasedAt ?? r.createdAt).toISOString(),
        listingTitle: r.listing.title,
        buyerUsername: r.buyer.username,
        status: r.paymentStatus,
        // What the buyer was charged for the item — informational, and NOT
        // the number the payout is derived from under the markup model.
        buyerPaid: r.listingPrice,
        // The seller's own starting figure, which the deductions come off.
        yourPrice: b.gross,
        commission: ded(b, 'Commission'),
        processingFee: ded(b, 'Payment processing fee'),
        shipping: r.shippingCost,
        netPayout: b.net,
        // True when our fees were inside the buyer's price, so the UI can say
        // so instead of showing two mysterious zeroes.
        feesInPrice: b.feesInPrice,
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
    // ⚠️ "Your price" − Commission − Processing fee = "Net payout", for BOTH
    // fee models. "Buyer paid" is shown alongside because under the markup
    // model it is a bigger number than the seller's own price and its absence
    // made the statement look wrong.
    const header = [
      'Reference',
      'Date',
      'Item',
      'Buyer',
      'Status',
      'Buyer paid',
      'Your price',
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
          rand(o.buyerPaid),
          rand(o.yourPrice),
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
      [
        'TOTAL',
        '',
        '',
        '',
        `${stmt.summary.orderCount} orders`,
        '',
        rand(stmt.summary.grossSales),
        rand(stmt.summary.totalCommission),
        rand(stmt.summary.totalProcessingFees),
        rand(stmt.summary.totalShipping),
        rand(stmt.summary.netPayout),
      ]
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
        where: {
          sellerId,
          swapId: null, // exclude synthetic SWOP settlement txs (S5)
          paymentStatus: 'RELEASED',
          releasedAt: { gte: from, lte: to },
        },
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
          AND "swapId" IS NULL
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
        // ⚠️ RENAMED, BECAUSE IT WAS NEVER "GROSS SALES". This is buyerTotal —
        // what the BUYER was charged, delivery and our margin included. Under
        // the markup model that is materially bigger than anything the seller
        // sold for, and it sat on the same screen as a statement table that
        // (correctly) shows the seller's own price, giving one page two
        // conflicting definitions of the same word. Net payout below is the
        // seller's real headline; this is the order value.
        buyerPaidCents: agg._sum.buyerTotal ?? 0,
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
