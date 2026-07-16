import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_MODE } from '../payments/transactions.service';

// Manual-EFT reconciliation (the inContact inbox scan + FNB statement CSV
// upload + unmatched queue + FNB payout-batch builder) has been REMOVED with
// the manual-EFT payment rail. What remains here are the rail-agnostic,
// read-only money-state accounting views the operator still needs:
//   - getPayoutsDue / getPayoutsDuePreview / collectDue — owed seller payouts
//     + buyer refunds (the docking / zero-net / residual math), plus the rows
//     a settlement would have to skip (missing bank details / KYC gate).
//   - getHeldFundsReport — the Client-Funds-Payable position.
//   - getZohoFailedSyncs — the Books failed-sync radar.
// A future card paygate settles the due rows directly by stamping
// Transaction.paidOutAt; none of this depends on the deleted EFT plumbing.

// A due payout/refund row a settlement would SKIP, with a structured reason,
// so the admin payouts-due preview can show blocked money.
export interface SkippedDueRow {
  kind: 'PAYOUT' | 'REFUND';
  ref: string;
  reason: string;
}

@Injectable()
export class ManualPaymentsService {
  private readonly logger = new Logger(ManualPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── P1.3 — Books failed-sync aggregate (read-only) ──────────────────
  // One place listing every entity whose latest Zoho sync FAILED, so the
  // operator doesn't have to trawl individual dossiers. Retry stays on
  // the per-transaction admin surface (ZB-10); this is the radar.
  async getZohoFailedSyncs() {
    const [transactions, featuredBids, subscriptionCharges, swaps] =
      await Promise.all([
        this.prisma.transaction.findMany({
          where: { zohoSyncStatus: 'FAILED' },
          orderBy: { zohoSyncLastAttemptAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            zohoSyncError: true,
            zohoSyncLastAttemptAt: true,
          },
        }),
        this.prisma.featuredSlotBid.findMany({
          where: { zohoSyncStatus: 'FAILED' },
          orderBy: { zohoSyncLastAttemptAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            zohoSyncError: true,
            zohoSyncLastAttemptAt: true,
          },
        }),
        // SubscriptionCharge has no zohoSync* columns — a receipt failure
        // is recorded in errorMessage on a SUCCEEDED charge whose
        // zohoReceiptId never got set.
        this.prisma.subscriptionCharge.findMany({
          where: {
            status: 'SUCCEEDED',
            zohoReceiptId: null,
            errorMessage: { startsWith: 'Zoho' },
          },
          orderBy: { chargedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            orderReference: true,
            errorMessage: true,
            chargedAt: true,
          },
        }),
        // P1.3 — COMPLETED swaps that still owe a leg-fee Sales Receipt (the
        // Zoho POST failed at completion). Swap has no zohoSync* columns, so
        // the signal is a fee>0 side with a null receipt id. These are
        // re-fired by the hourly retryMissingSwapFeeReceipts cron.
        this.prisma.swap.findMany({
          where: {
            status: 'COMPLETED',
            OR: [
              { swapFeeInitiator: { gt: 0 }, zohoInitiatorFeeReceiptId: null },
              { swapFeeOwner: { gt: 0 }, zohoOwnerFeeReceiptId: null },
            ],
          },
          orderBy: { completedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            initiatorFundingRef: true,
            swapFeeInitiator: true,
            zohoInitiatorFeeReceiptId: true,
            swapFeeOwner: true,
            zohoOwnerFeeReceiptId: true,
            completedAt: true,
          },
        }),
      ]);
    return {
      transactions,
      featuredBids,
      subscriptionCharges,
      swaps,
      totalFailed:
        transactions.length +
        featuredBids.length +
        subscriptionCharges.length +
        swaps.length,
    };
  }

  // ── P1.4 — Held-funds reconciliation (CFP position, read-only) ──────
  // "How much of the FNB balance is CLIENT money, not GG's?" — the number
  // the operator checks the bank balance against. Four components:
  //   1. Buyer money held pending delivery/release (HELD / admin-verify /
  //      DISPUTED, payment actually captured).
  //   2. Seller payouts owed (RELEASED, not yet paid out), net of refund
  //      children exactly like the payout queue.
  //   3. Buyer refunds owed (REFUNDED rows not yet paid; children carry
  //      their slice, parents their residual — mirrors collectDue).
  //   4. Swap money held: locked-swap cash top-ups awaiting release +
  //      one-sided funding captured before lock.
  async getHeldFundsReport() {
    const childrenSum = (c?: { buyerTotal: number }[] | null) =>
      (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

    // (1) Held from buyers. Rail-agnostic "money has arrived" test = paidAt is
    // set (a HELD row whose payment was captured by markPaid). Excludes swap
    // legs (they carry zero money — cash lives on the Swap, buckets 4a/4b) and
    // refund children, and nets out any refund children already counted in
    // bucket 3 so a partial refund on a still-HELD parent isn't double-counted.
    const heldRows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: {
          in: ['HELD', 'PENDING_ADMIN_VERIFICATION', 'DISPUTED'],
        },
        refundOfId: null,
        swapId: null,
        paidAt: { not: null },
      },
      select: {
        buyerTotal: true,
        refundChildren: { select: { buyerTotal: true } },
      },
    });
    const heldAwaitingRelease = {
      count: heldRows.length,
      cents: heldRows.reduce(
        (s, r) => s + Math.max(0, r.buyerTotal - childrenSum(r.refundChildren)),
        0,
      ),
    };

    // (2) Owed to sellers — RELEASED and not yet settled.
    const payoutRows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        refundOfId: null,
      },
      select: {
        sellerPayout: true,
        refundChildren: { select: { buyerTotal: true } },
      },
    });
    const owedToSellers = {
      count: payoutRows.length,
      cents: payoutRows.reduce(
        (s, r) => s + Math.max(0, r.sellerPayout - childrenSum(r.refundChildren)),
        0,
      ),
    };

    // (3) Owed to buyers — refunds not yet paid (manual mode only; a card
    // gateway reverses on the card so nothing is owed from the account).
    const refundRows =
      PAYMENT_MODE !== 'manual'
        ? []
        : await this.prisma.transaction.findMany({
            where: {
              paymentStatus: 'REFUNDED',
              buyerTotal: { gt: 0 },
              paidOutAt: null,
            },
            select: {
              refundOfId: true,
              buyerTotal: true,
              refundChildren: { select: { buyerTotal: true } },
            },
          });
    const owedToBuyerRefunds = {
      count: refundRows.length,
      cents: refundRows.reduce(
        (s, r) =>
          s +
          (r.refundOfId
            ? r.buyerTotal // child = its slice
            : Math.max(0, r.buyerTotal - childrenSum(r.refundChildren))), // parent = residual
        0,
      ),
    };

    // (4a) Swap cash top-ups held between LOCK and release.
    const lockedSwaps = await this.prisma.swap.findMany({
      where: {
        status: { in: ['LOCKED', 'IN_TRANSIT', 'AWAITING_VERIFICATION', 'DISPUTED'] },
        cashReleasedAt: null,
        cashAmount: { gt: 0 },
      },
      select: { cashAmount: true },
    });
    const swapCashHeld = {
      count: lockedSwaps.length,
      cents: lockedSwaps.reduce((s, r) => s + r.cashAmount, 0),
    };

    // (4b) One-sided funding captured pre-lock: a party has paid their
    // funding EFT but the swap hasn't locked — if the other side lapses
    // this money is reimbursed, so it's a liability while it sits here.
    const fundingSwaps = await this.prisma.swap.findMany({
      where: {
        status: 'AWAITING_FUNDING',
        OR: [
          { initiatorVerifiedAt: { not: null }, initiatorRefundedAt: null },
          { ownerVerifiedAt: { not: null }, ownerRefundedAt: null },
        ],
      },
      select: {
        initiatorVerifiedAt: true,
        initiatorRefundedAt: true,
        initiatorFundingAmount: true,
        ownerVerifiedAt: true,
        ownerRefundedAt: true,
        ownerFundingAmount: true,
      },
    });
    let fundingCents = 0;
    for (const s of fundingSwaps) {
      if (s.initiatorVerifiedAt && !s.initiatorRefundedAt)
        fundingCents += s.initiatorFundingAmount;
      if (s.ownerVerifiedAt && !s.ownerRefundedAt)
        fundingCents += s.ownerFundingAmount;
    }
    const swapFundingInFlight = { count: fundingSwaps.length, cents: fundingCents };

    return {
      asOf: new Date().toISOString(),
      paymentMode: PAYMENT_MODE,
      heldAwaitingRelease,
      owedToSellers,
      owedToBuyerRefunds,
      swapCashHeld,
      swapFundingInFlight,
      totalClientFundsCents:
        heldAwaitingRelease.cents +
        owedToSellers.cents +
        owedToBuyerRefunds.cents +
        swapCashHeld.cents +
        swapFundingInFlight.cents,
    };
  }

  // ── Payouts due (read-only) ─────────────────────────────────────────
  // Seller payouts: transactions whose funds have been RELEASED (buyer
  // confirmed delivery / dealer-verify approved / PRIVATE_ARRANGE) and are
  // owed to the seller. Buyer refunds: transactions marked REFUNDED that still
  // need the money sent back. "Due" = owed but not yet settled (paidOutAt null)
  // and not on a payout hold (payoutHeldAt null). A future paygate settles
  // these by stamping paidOutAt.
  async getPayoutsDue() {
    const payouts = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        // P0.3 — synthetic refund children are never seller payouts.
        refundOfId: null,
        // M26 — a held row is withheld from the sweep until an admin clears
        // the hold (post-release fraud lever).
        payoutHeldAt: null,
      },
      orderBy: { releasedAt: 'asc' },
      select: {
        id: true,
        orderReference: true,
        sellerPayout: true,
        refundedAmount: true,
        // P0.3 review fix — the seller is docked only for refund slices the
        // buyer is ACTUALLY being paid (i.e. minted children), never for
        // legacy pre-deploy refundedAmount that no money ever moved for.
        refundChildren: { select: { buyerTotal: true } },
        releasedAt: true,
        seller: {
          select: {
            username: true,
            email: true,
            phone: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
            bankAccountType: true,
            // FLOW-F1 — the documented payout HARD GATE (profile complete +
            // KYC VERIFIED). collectDue skips sellers failing it.
            kycStatus: true,
            profileCompletedAt: true,
          },
        },
      },
    });
    // Refunds are only owed by EFT/bank payout in MANUAL mode. Under a live
    // card gateway the reversal happens on the card, so paying these rows would
    // refund a SECOND time — hard-gate on manual mode.
    //
    // P0.3 — two row shapes are due:
    //  (a) synthetic refund CHILDREN (refundOfId set) — one per admin refund
    //      operation, buyerTotal = that slice.
    //  (b) REFUNDED PARENTS, paid their RESIDUAL: buyerTotal − Σ(children).
    //      A parent fully covered by children nets to ≤0 and is dropped in
    //      collectDue. Exactly-once per row via paidOutAt.
    const refunds = PAYMENT_MODE !== 'manual' ? [] : await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'REFUNDED',
        buyerTotal: { gt: 0 },
        paidOutAt: null,
        // M26 — held refund rows are withheld from the sweep too.
        payoutHeldAt: null,
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        refundOfId: true,
        orderReference: true,
        buyerTotal: true,
        refundChildren: { select: { buyerTotal: true } },
        updatedAt: true,
        buyer: {
          select: {
            username: true,
            email: true,
            phone: true,
            bankAccountHolder: true,
            bankName: true,
            bankAccountNumber: true,
            bankBranchCode: true,
            bankAccountType: true,
          },
        },
      },
    });
    return { payouts, refunds };
  }

  // Owed-money math for the payouts-due preview: which rows are payable, which
  // net to R0 (fully consumed by refund slices), and which are BLOCKED (missing
  // bank details / KYC gate) with a structured reason. The FNB-CSV recipient
  // shaping that used to live here has been removed with the manual rail; the
  // docking / zero-net / residual math is preserved (a future paygate reuses
  // it). Read-only: performs no writes.
  private async collectDue(
    pre?: Awaited<ReturnType<ManualPaymentsService['getPayoutsDue']>>,
  ) {
    const { payouts, refunds } = pre ?? (await this.getPayoutsDue());
    const payoutIds: string[] = [];
    const refundIds: string[] = [];
    // Rows that net to R0 (fully consumed by refund slices) — they owe no
    // payment but MUST be settled (stamped) or they zombie in the due queue.
    const zeroNetIds: string[] = [];
    let payoutTotalCents = 0;
    let refundTotalCents = 0;
    const skipped: SkippedDueRow[] = [];

    const hasBank = (b: {
      bankAccountHolder: string | null;
      bankAccountNumber: string | null;
      bankBranchCode: string | null;
    }) => !!(b.bankAccountHolder && b.bankAccountNumber && b.bankBranchCode);

    const childrenSum = (c?: { buyerTotal: number }[] | null) =>
      (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

    for (const p of payouts) {
      // P0.3 — dock the seller ONLY for refund slices actually being paid to
      // the buyer (minted children). Legacy pre-deploy refundedAmount without
      // children never moved money.
      const covered = childrenSum(p.refundChildren);
      const payoutAmount = Math.max(0, p.sellerPayout - covered);
      if (payoutAmount <= 0) {
        // Fully consumed by refunds — nets to R0.
        zeroNetIds.push(p.id);
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason:
            'Nets to R0 — fully consumed by refund slices; settled without a payout (no action needed)',
        });
        continue;
      }
      if (!hasBank(p.seller)) {
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? '(no username)'} has no bank details on file — payout waits until they add banking details on their profile`,
        });
        continue;
      }
      // FLOW-F1 — payout KYC hard gate. A seller is paid ONLY once their profile
      // is complete AND KYC is VERIFIED. Buyer REFUND rows below are deliberately
      // NOT gated — returning a buyer's own money must never wait on seller-style
      // verification.
      if (p.seller.kycStatus !== 'VERIFIED' || !p.seller.profileCompletedAt) {
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? '(no username)'}: ${
            p.seller.kycStatus !== 'VERIFIED' ? 'KYC not verified' : 'profile incomplete'
          } — payout held until verified`,
        });
        continue;
      }
      payoutIds.push(p.id);
      payoutTotalCents += payoutAmount;
    }

    for (const r of refunds) {
      // P0.3 — children pay their own slice; a REFUNDED parent pays the
      // RESIDUAL its children don't carry. A parent fully covered by children
      // owes nothing (nets to R0).
      const amount = r.refundOfId
        ? r.buyerTotal
        : Math.max(0, r.buyerTotal - childrenSum(r.refundChildren));
      if (amount <= 0) {
        zeroNetIds.push(r.id);
        continue;
      }
      if (!hasBank(r.buyer)) {
        skipped.push({
          kind: 'REFUND',
          ref: r.orderReference ?? r.id,
          reason: `Buyer ${r.buyer.username ?? '(no username)'} has no bank details on file — refund waits until they add banking details on their profile (refund notifications link them there)`,
        });
        continue;
      }
      refundIds.push(r.id);
      refundTotalCents += amount;
    }

    return {
      payoutIds,
      refundIds,
      zeroNetIds,
      payoutTotalCents,
      refundTotalCents,
      skipped,
    };
  }

  // FLOW-F2 — admin preview: everything due now PLUS the rows a settlement
  // would skip (missing bank details / KYC gate / zero-net), each with a
  // structured reason, so the operator sees blocked money on the payouts-due
  // panel. Read-only.
  async getPayoutsDuePreview() {
    const due = await this.getPayoutsDue();
    const { skipped } = await this.collectDue(due);
    return { ...due, skipped };
  }
}
