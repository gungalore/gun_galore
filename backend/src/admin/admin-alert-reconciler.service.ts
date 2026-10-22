import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ADMIN ALERT RECONCILER — close alerts whose cause is provably gone.
 *
 * ⚠️ WHY THIS EXISTS. AdminAlert rows were only ever raised. A handful of
 * services resolved their own alert on the happy path (dispute, cancellation,
 * complaint, support, KYC review, reject strikes), but most did not — so a job
 * that recovered, a parcel that arrived, a payout that eventually succeeded or
 * a seller who verified all left a red row in the inbox forever. The operator
 * could now clear them by hand, but a queue that only grows is a queue nobody
 * trusts, and "clear" was the only way to learn whether the fault was still
 * real.
 *
 * ⚠️ ONLY UNAMBIGUOUS CONDITIONS. Every rule below reads the CURRENT state of
 * the row the alert is about. An alert is resolved only when that state makes
 * the alert false: a parcel that is DELIVERED cannot still be stalled in
 * transit, a payout with paidOutAt set did not fail, a user with no reject
 * strikes is not on a strike threshold. Anything requiring judgement (a
 * chargeback, a chargeback race, a moderation call, an outage we cannot
 * observe) is deliberately left for a human.
 *
 * Runs every 10 minutes from TasksService. Bounded queries, no per-alert
 * round-trips except for the three AI-outage rules, which are rare.
 */

export interface TxAlertState {
  id: string;
  paymentStatus: string;
  paidAt: Date | null;
  paidOutAt: Date | null;
  shipmentBookedAt: Date | null;
  deliveredAt: Date | null;
  shippingStatus: string | null;
  dealerVerificationStatus: string | null;
}

export interface UserAlertState {
  id: string;
  kycStatus: string;
  sellerRejectStrikes: number;
  sellingBannedAt: Date | null;
  dispatchStrikes: number;
  auctionStrikes: number;
}

export interface TxAlertRule {
  rule: string;
  types: readonly string[];
  clear: (tx: TxAlertState) => boolean;
}

export interface UserAlertRule {
  rule: string;
  types: readonly string[];
  clear: (user: UserAlertState) => boolean;
}

/** Exported so the predicates can be tested without a database. */
export const TX_ALERT_RULES: readonly TxAlertRule[] = [
  {
    // Money left HELD: released, refunded or otherwise settled. The stall is
    // over, whatever the admin did to end it.
    rule: 'tx-out-of-held',
    types: [
      'STUCK_HELD_FUNDS_BUYER_UNCONFIRMED',
      'STUCK_HELD_FUNDS_COLLECTION_UNCONFIRMED',
      'STORE_PICKUP_PAYOUT_AVAILABLE',
      'SALE_ACCEPT_STALLED',
    ],
    clear: (tx) =>
      tx.paymentStatus === 'RELEASED' || tx.paymentStatus === 'REFUNDED',
  },
  {
    // A later attempt booked the parcel. The failure was real, its cause is not.
    rule: 'shipment-booked',
    types: ['SHIPMENT_BOOKING_FAILED'],
    clear: (tx) => tx.shipmentBookedAt !== null,
  },
  {
    // Transit resumed to completion.
    rule: 'shipment-arrived',
    types: ['SHIPMENT_TRANSIT_STALL'],
    clear: (tx) =>
      tx.deliveredAt !== null ||
      tx.shippingStatus === 'DELIVERED' ||
      tx.shippingStatus === 'COLLECTED',
  },
  {
    // A failed/returned parcel has been dealt with (refunded or released).
    rule: 'shipment-decided',
    types: ['SHIPMENT_DELIVERY_FAILED', 'SHIPMENT_RETURNED'],
    clear: (tx) =>
      tx.paymentStatus === 'RELEASED' || tx.paymentStatus === 'REFUNDED',
  },
  {
    // The dealer verdict landed, or the sale itself was settled.
    rule: 'dealer-decided',
    types: [
      'DEALER_VERIFICATION_NEEDS_REVIEW',
      'DEALER_VERIFICATION_REVIEW_OVERDUE',
      'DEALER_TRANSFER_STALLED',
    ],
    clear: (tx) =>
      tx.dealerVerificationStatus === 'APPROVED' ||
      tx.dealerVerificationStatus === 'REJECTED' ||
      tx.paymentStatus === 'RELEASED' ||
      tx.paymentStatus === 'REFUNDED',
  },
  {
    // The order eventually marked paid, so the refused mark-paid was retried.
    rule: 'markpaid-recovered',
    types: ['OZOW_VERIFY_MARKPAID_REJECTED', 'OZOW_WEBHOOK_MARKPAID_REJECTED'],
    clear: (tx) => tx.paidAt !== null,
  },
  {
    // The payout succeeded on a later attempt.
    rule: 'payout-completed',
    types: ['OZOW_PAYOUT_FAILED'],
    clear: (tx) => tx.paidOutAt !== null,
  },
  {
    // A manual refund settled what the automatic path could not.
    rule: 'refund-landed',
    types: [
      'SALE_REJECT_NO_PAYMENT_ID',
      'SALE_REJECT_REFUND_FAILED',
      'BUYER_CANCEL_NO_PAYMENT_ID',
      'BUYER_CANCEL_REFUND_FAILED',
      'ADMIN_REFUND_GATEWAY_FAILED',
    ],
    clear: (tx) => tx.paymentStatus === 'REFUNDED',
  },
  {
    // The dispute/cancellation was resolved one way or the other.
    rule: 'dispute-closed',
    types: ['BUYER_DISPUTE_RAISED', 'CANCELLATION_REQUESTED'],
    clear: (tx) =>
      tx.paymentStatus === 'RELEASED' || tx.paymentStatus === 'REFUNDED',
  },
  {
    // The "approved but unpaid" refusal no longer applies once funded or moved.
    rule: 'dealer-unpaid-recovered',
    types: ['DEALER_VERIFY_UNPAID'],
    clear: (tx) =>
      tx.paidAt !== null ||
      tx.paymentStatus === 'RELEASED' ||
      tx.paymentStatus === 'REFUNDED',
  },
];

/** Exported so the predicates can be tested without a database. */
export const USER_ALERT_RULES: readonly UserAlertRule[] = [
  {
    // A human decided the verification.
    rule: 'kyc-review-closed',
    types: ['KYC_REVIEW'],
    clear: (user) => user.kycStatus !== 'UNDER_REVIEW',
  },
  {
    // Repeated failures ended in a pass (a human or a retry).
    rule: 'kyc-verified',
    types: ['KYC_REPEATED_FAILURE'],
    clear: (user) => user.kycStatus === 'VERIFIED',
  },
  {
    // Strikes were cleared, so neither the strike nor its review is open.
    rule: 'reject-strikes-cleared',
    types: ['SELLER_REJECT_STRIKE', 'SELLER_REJECT_REVIEW'],
    clear: (user) => user.sellerRejectStrikes === 0 && user.sellingBannedAt === null,
  },
  {
    // Threshold alerts only make sense while the counter is above zero. We do
    // not know the configured threshold here, and zero is below all of them.
    rule: 'dispatch-strikes-cleared',
    types: ['SELLER_DISPATCH_STRIKES_THRESHOLD'],
    clear: (user) => user.dispatchStrikes === 0,
  },
  {
    rule: 'auction-strikes-cleared',
    types: ['BIDDER_AUCTION_STRIKES_THRESHOLD'],
    clear: (user) => user.auctionStrikes === 0,
  },
];

/**
 * Outage alerts resolved by proof of a later success, not by a counter.
 * `purposes` are the AiUsage purposes that prove the specific rail recovered.
 */
export const AI_OUTAGE_RULES: readonly {
  rule: string;
  type: string;
  purposes: readonly string[];
}[] = [
  {
    rule: 'motivation-writer-recovered',
    type: 'motivation-writer-down',
    purposes: ['motivation.generate', 'motivation.repair', 'motivation.gate'],
  },
  {
    rule: 'kyc-outage-recovered',
    type: 'kyc-claude-outage',
    purposes: ['KYC_VERIFY', 'kyc.face-match'],
  },
  {
    rule: 'firearm-verifier-recovered',
    type: 'firearm-licence-verifier-down',
    purposes: ['listing.licence-read', 'licence.card.read', 'licence.card.read.id'],
  },
];

const MAX_ALERTS_PER_RULE = 500;

@Injectable()
export class AdminAlertReconcilerService {
  private readonly logger = new Logger(AdminAlertReconcilerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcile(): Promise<{ resolved: number; byRule: Record<string, number> }> {
    const byRule: Record<string, number> = {};
    const add = (rule: string, n: number) => {
      if (n > 0) byRule[rule] = (byRule[rule] ?? 0) + n;
    };

    const resolvedTx = await this.reconcileTransactions();
    for (const [rule, n] of Object.entries(resolvedTx)) add(rule, n);

    const resolvedUsers = await this.reconcileUsers();
    for (const [rule, n] of Object.entries(resolvedUsers)) add(rule, n);

    add('reported-listing-removed', await this.reconcileReportedListings());
    add('saps-tracker-recovered', await this.reconcileTracker());
    add('ai-outage-recovered', await this.reconcileAiOutages());

    const resolved = Object.values(byRule).reduce((sum, n) => sum + n, 0);
    if (resolved > 0) {
      this.logger.log(
        `AdminAlert reconciler resolved ${resolved} row(s): ${JSON.stringify(byRule)}`,
      );
    }
    return { resolved, byRule };
  }

  private async takeAlerts(types: readonly string[]) {
    return this.prisma.adminAlert.findMany({
      where: {
        type: { in: [...types] },
        resolved: false,
        referenceId: { not: null },
      },
      select: { id: true, type: true, referenceId: true, createdAt: true },
      take: MAX_ALERTS_PER_RULE,
    });
  }

  private async resolve(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await this.prisma.adminAlert.updateMany({
      where: { id: { in: ids }, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
    return r.count;
  }

  private async reconcileTransactions(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rule of TX_ALERT_RULES) {
      const alerts = await this.takeAlerts(rule.types);
      if (alerts.length === 0) continue;

      const refIds = [
        ...new Set(
          alerts
            .map((a) => a.referenceId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      if (refIds.length === 0) continue;

      const txs = await this.prisma.transaction.findMany({
        where: { id: { in: refIds } },
        select: {
          id: true,
          paymentStatus: true,
          paidAt: true,
          paidOutAt: true,
          shipmentBookedAt: true,
          deliveredAt: true,
          shippingStatus: true,
          dealerVerificationStatus: true,
        },
      });
      const cleared = new Set(
        (txs as TxAlertState[])
          .filter((tx) => rule.clear(tx))
          .map((tx) => tx.id),
      );
      out[rule.rule] = await this.resolve(
        alerts
          .filter((a) => a.referenceId !== null && cleared.has(a.referenceId))
          .map((a) => a.id),
      );
    }
    return out;
  }

  private async reconcileUsers(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rule of USER_ALERT_RULES) {
      const alerts = await this.takeAlerts(rule.types);
      if (alerts.length === 0) continue;

      const refIds = [
        ...new Set(
          alerts
            .map((a) => a.referenceId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      if (refIds.length === 0) continue;

      const users = await this.prisma.user.findMany({
        where: { id: { in: refIds } },
        select: {
          id: true,
          kycStatus: true,
          sellerRejectStrikes: true,
          sellingBannedAt: true,
          dispatchStrikes: true,
          auctionStrikes: true,
        },
      });
      const cleared = new Set(
        (users as UserAlertState[])
          .filter((user) => rule.clear(user))
          .map((user) => user.id),
      );
      out[rule.rule] = await this.resolve(
        alerts
          .filter((a) => a.referenceId !== null && cleared.has(a.referenceId))
          .map((a) => a.id),
      );
    }
    return out;
  }

  /**
   * A report is answered once the listing is off the catalogue. Left open when
   * the listing is still live — that is still a decision for a human.
   */
  private async reconcileReportedListings(): Promise<number> {
    const alerts = await this.takeAlerts(['LISTING_REPORTED']);
    if (alerts.length === 0) return 0;
    const refIds = [
      ...new Set(
        alerts
          .map((a) => a.referenceId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (refIds.length === 0) return 0;
    const removed = await this.prisma.listing.findMany({
      where: { id: { in: refIds }, status: 'CANCELLED' },
      select: { id: true },
    });
    const cleared = new Set(removed.map((l) => l.id));
    return this.resolve(
      alerts
        .filter((a) => a.referenceId !== null && cleared.has(a.referenceId))
        .map((a) => a.id),
    );
  }

  /**
   * The SAPS page parsed successfully on a later poll. `lastOutcome` is the
   * poll result, not the application status, so this is the exact recovery
   * signal.
   */
  private async reconcileTracker(): Promise<number> {
    const alerts = await this.takeAlerts(['SAPS_TRACKER_UNREADABLE']);
    let count = 0;
    for (const alert of alerts) {
      if (!alert.referenceId) continue;
      const row = await this.prisma.trackedApplication.findUnique({
        where: { id: alert.referenceId },
        select: { lastCheckedAt: true, lastOutcome: true },
      });
      if (!row?.lastCheckedAt) continue;
      if (row.lastCheckedAt <= alert.createdAt) continue;
      if (row.lastOutcome === 'error') continue;
      count += await this.resolve([alert.id]);
    }
    return count;
  }

  /**
   * A successful AI call on the same rail after the alert is proof the outage
   * ended. Bounded and per-alert: an outage alert is rare, the inbox does not
   * carry hundreds of them.
   */
  private async reconcileAiOutages(): Promise<number> {
    let count = 0;
    for (const rule of AI_OUTAGE_RULES) {
      const alerts = await this.prisma.adminAlert.findMany({
        where: { type: rule.type, resolved: false },
        select: { id: true, createdAt: true },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });
      for (const alert of alerts) {
        const recovered = await this.prisma.aiUsage.count({
          where: {
            ok: true,
            purpose: { in: [...rule.purposes] },
            createdAt: { gt: alert.createdAt },
          },
        });
        if (recovered > 0) count += await this.resolve([alert.id]);
      }
    }
    return count;
  }
}
