import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fraud-risk scoring (Phase 3b). Computed AFTER a payment is captured
// (called fire-and-forget from TransactionsService.markPaid), so it can
// never block or fail the money path. LOG-ONLY: it stamps a 0–100 score +
// the triggered flag keys on the Transaction for an admin to review. It
// never auto-refunds, holds, or bans — that stays a manual decision.
//
// Signals (all derived from data we already hold — no IP/device capture in
// this cut; that's a noted follow-up that would touch the checkout path):
//   - new_account            buyer registered < 7 days before this order
//   - high_value_first_order  buyer's first paid order AND > R5 000
//   - rapid_repeat_orders     >= 3 paid orders by this buyer in 24h
//   - contact_violations      buyer tripped the contact-detail filter in 24h
//   - shared_phone            another account shares this buyer's phone

const WEIGHTS = {
  new_account: 20,
  high_value_first_order: 30,
  rapid_repeat_orders: 25,
  contact_violations: 20,
  shared_phone: 25,
} as const;

const HIGH_VALUE_CENTS = 500_000; // R5 000
const DAY = 24 * 3600 * 1000;

@Injectable()
export class FraudRiskService {
  private readonly logger = new Logger(FraudRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(transactionId: string): Promise<void> {
    try {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          buyerId: true,
          buyerTotal: true,
          createdAt: true,
          buyer: { select: { id: true, createdAt: true, phone: true } },
        },
      });
      if (!tx || !tx.buyer) return;

      const now = tx.createdAt?.getTime() ?? Date.now();
      const flags: string[] = [];

      // new_account — registered within the last 7 days.
      const accountAgeMs = now - (tx.buyer.createdAt?.getTime() ?? now);
      const isNew = accountAgeMs < 7 * DAY;
      if (isNew) flags.push('new_account');

      // Count this buyer's PAID orders (paidAt set), and how many in 24h.
      const [paidCount, rapidCount, contactViolations, sharedPhone] =
        await Promise.all([
          this.prisma.transaction.count({
            where: { buyerId: tx.buyerId, paidAt: { not: null } },
          }),
          this.prisma.transaction.count({
            where: {
              buyerId: tx.buyerId,
              paidAt: { gte: new Date(now - DAY) },
            },
          }),
          this.prisma.contactDetailRejection.count({
            where: {
              userId: tx.buyerId,
              createdAt: { gte: new Date(now - DAY) },
            },
          }),
          tx.buyer.phone
            ? this.prisma.user.count({
                where: {
                  phone: tx.buyer.phone,
                  id: { not: tx.buyerId },
                },
              })
            : Promise.resolve(0),
        ]);

      // high_value_first_order — this is their first paid order (count<=1
      // because this order itself is now counted) and it's large.
      if (paidCount <= 1 && tx.buyerTotal > HIGH_VALUE_CENTS) {
        flags.push('high_value_first_order');
      }
      if (rapidCount >= 3) flags.push('rapid_repeat_orders');
      if (contactViolations >= 1) flags.push('contact_violations');
      if (sharedPhone >= 1) flags.push('shared_phone');

      const score = Math.min(
        100,
        flags.reduce((s, f) => s + (WEIGHTS[f as keyof typeof WEIGHTS] ?? 0), 0),
      );

      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { riskScore: score, riskFlags: flags },
      });

      if (score >= 50) {
        this.logger.warn(
          `High fraud-risk order ${transactionId}: score ${score} [${flags.join(', ')}]`,
        );
      }
    } catch (err) {
      // Never let risk scoring disturb the payment flow.
      this.logger.error(
        `fraud-risk evaluate(${transactionId}) failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
