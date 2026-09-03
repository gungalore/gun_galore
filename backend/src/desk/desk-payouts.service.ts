import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ManualPaymentsService, netPayoutCents } from '../manual-payments/manual-payments.service';

/**
 * THE DESK — the payout run, as the operator sees it.
 *
 * ⚠️ THE UNIT OF A PAYOUT IS ONE SALE. Never a seller, never the run. A seller
 * with three released sales is three rows here, each of which can be paid on
 * its own or held back on its own. That is not a display choice: it is what
 * getPayoutsDue already returns (one row per transaction, with the seller's
 * banking duplicated inline), and grouping them by seller in the UI would
 * invent a unit the money rail does not have — and would make "hold this one
 * back" impossible to express.
 *
 * ⚠️ NOTHING IS EVER PAID THAT THE OPERATOR HAS NOT SEEN LISTED. This service
 * is read-only. It exists so the run can be reviewed sale by sale before the
 * one button that moves money is pressed.
 */
@Injectable()
export class DeskPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manualPayments: ManualPaymentsService,
  ) {}

  private rand(cents: number): string {
    return `R${Math.round(cents / 100).toLocaleString('en-ZA')}`;
  }

  /**
   * The run in three sections: what would go out, what the operator has held
   * back, and what the gates are blocking.
   *
   * The first and third come from getPayoutsDuePreview, which is the same call
   * the existing payouts-due panel makes — so the Desk and that panel can
   * never disagree about what is due. The middle section is a separate query,
   * because held rows are excluded from getPayoutsDue by design.
   */
  async run() {
    const [preview, held] = await Promise.all([
      this.manualPayments.getPayoutsDuePreview(),
      this.prisma.transaction.findMany({
        where: { paymentStatus: 'RELEASED', paidOutAt: null, payoutHeldAt: { not: null } },
        select: {
          id: true,
          orderReference: true,
          sellerPayout: true,
          failedShipmentChargeCents: true,
          refundedAmount: true,
          refundChildren: { select: { buyerTotal: true } },
          payoutHeldAt: true,
          payoutHoldReason: true,
          listing: { select: { title: true } },
          seller: { select: { username: true } },
        },
        orderBy: { payoutHeldAt: 'desc' },
      }),
    ]);

    // A skipped row carries a ref and a reason but no id, so match on the same
    // string the service built it from: orderReference, else the raw id.
    const blockedRefs = new Map(
      (preview.skipped ?? [])
        .filter((s) => s.kind === 'PAYOUT')
        .map((s) => [s.ref, s.reason] as const),
    );

    const rows = (preview.payouts ?? []).map((p) => {
      const ref = p.orderReference ?? p.id;
      return {
        id: p.id,
        reference: p.orderReference ?? p.id.slice(-8).toUpperCase(),
        item: (p as { listing?: { title?: string } }).listing?.title ?? 'Sale',
        seller: p.seller?.username ?? null,
        // ⚠️ NET, NOT sellerPayout. The seller is docked for refund slices
        // actually being paid to the buyer and for a wasted courier charge;
        // showing the gross here would put a number on screen that is not the
        // number that leaves the account.
        amountCents: netPayoutCents(p),
        bankVerified: Boolean(p.seller?.bankVerifiedAt),
        blockedReason: blockedRefs.get(ref) ?? null,
      };
    });

    const inRun = rows.filter((r) => !r.blockedReason);
    const blocked = rows.filter((r) => r.blockedReason);

    const heldRows = held.map((h) => ({
      id: h.id,
      reference: h.orderReference ?? h.id.slice(-8).toUpperCase(),
      item: h.listing?.title ?? 'Sale',
      seller: h.seller?.username ?? null,
      amountCents: netPayoutCents(h),
      heldAt: h.payoutHeldAt?.toISOString() ?? null,
      reason: h.payoutHoldReason ?? null,
    }));

    const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
    const inRunTotal = sum(inRun);

    return {
      // ⚠️ THE GATE IS PART OF THE ANSWER, not something the client infers.
      // Read the same way the checkout reads it, so the two can never
      // disagree about whether money can move.
      gated: process.env.PAYMENTS_LIVE !== 'true',
      inRun,
      held: heldRows,
      blocked,
      totals: {
        inRunCents: inRunTotal,
        inRunLabel: this.rand(inRunTotal),
        heldCents: sum(heldRows),
        heldLabel: this.rand(sum(heldRows)),
        blockedCents: sum(blocked),
        blockedLabel: this.rand(sum(blocked)),
        // Sellers, for the title line only — the unit stays the sale.
        sellerCount: new Set(inRun.map((r) => r.seller).filter(Boolean)).size,
        saleCount: inRun.length,
      },
    };
  }
}
