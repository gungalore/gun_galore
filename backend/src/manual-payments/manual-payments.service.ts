import { Injectable, Logger, Optional } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { PAYMENT_MODE } from '../payments/transactions.service';
import { PAYMENTS_LIVE } from '../payments/payment-mode';
import {
  OzowService,
  OzowPayoutBeneficiary,
  OzowPayoutResult,
} from '../payments/ozow.service';
import { normaliseOzowBank, bankByBranchCode } from '../payments/ozow-banks';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import {
  PeachService,
  PeachPayoutBeneficiary,
} from '../payments/peach.service';
import {
  normaliseBankName,
  universalBranchCodeFor,
} from '../payments/peach-banks';
import {
  reserveSellerChargesForPayout,
  settleSellerChargeRecoveries,
  releaseSellerChargeRecoveries,
  outstandingSellerChargeCents,
} from '../common/seller-charges';

// Manual-EFT reconciliation (the inContact inbox scan + FNB statement CSV
// upload + unmatched queue + FNB payout-batch builder) has been REMOVED with
// the manual-EFT payment rail. What remains here are the rail-agnostic,
// Ozow payout runner and money-state views:
//   - runDuePayouts — operator-triggered Ozow seller disbursement
//   - getPayoutsDue / getPayoutsDuePreview / collectDue — owed seller payouts
//     + buyer refunds (the docking / zero-net / residual math), plus the rows
//     a settlement would have to skip (missing bank details / KYC gate).
//   - getHeldFundsReport — the Client-Funds-Payable position.
//   - getZohoFailedSyncs — the Books failed-sync radar.
// Accepted payout requests stamp Transaction.paidOutAt; their final outcomes
// are reconciled through Ozow's notification and status-check endpoints.

// A due payout/refund row a settlement would SKIP, with a structured reason,
// so the admin payouts-due preview can show blocked money.
export interface SkippedDueRow {
  kind: 'PAYOUT' | 'REFUND';
  ref: string;
  reason: string;
}

// What a seller is actually paid: the agreed payout, less refund slices being
// paid to the buyer, less any wasted courier charge they owe.
//
// sellerPayout is a POINT-OF-SALE SNAPSHOT and is never mutated — so both
// deductions are applied here, at the moment money moves, and stay visible as
// separate explainable lines rather than silently rewriting the sale.
//
// failedShipmentChargeCents is set when a shipment failed through the seller's
// own error (see common/shipment-failure-policy.ts) — most often a parcel
// measured smaller than it really is, which then does not fit the collection
// point. It accumulates across repeat failures. Clamped at zero: a charge
// larger than the payout must never invert into money owed TO us on a payout
// run — recovering more than the sale is worth is a decision for a human.
export function netPayoutCents(p: {
  sellerPayout: number;
  failedShipmentChargeCents?: number | null;
  refundChildren?: { buyerTotal: number }[] | null;
  /** Slice of this payout withheld to recover a seller failure charge. */
  chargeRecoveryCents?: number | null;
}): number {
  const refunded = (p.refundChildren ?? []).reduce((s, x) => s + x.buyerTotal, 0);
  return Math.max(
    0,
    p.sellerPayout -
      refunded -
      (p.failedShipmentChargeCents ?? 0) -
      (p.chargeRecoveryCents ?? 0),
  );
}

@Injectable()
export class ManualPaymentsService {
  private readonly logger = new Logger(ManualPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // SettingsService is @Global (SettingsModule) — no module import needed.
    private readonly settings: SettingsService,
    // OzowService is @Global (OzowModule) — no PaymentsModule import needed.
    private readonly ozow: OzowService,
    // @Global PeachModule. Optional for positional test harnesses; the Peach
    // arm simply reports "not configured" when absent.
    @Optional()
    private readonly peach?: PeachService,
    // ⚠️ THE PAYOUT IS THE MOMENT A SELLER-SIDE BOOKS DOCUMENT BECOMES TRUE.
    // The commission invoice and any courier re-weigh invoice are settled here,
    // not at release: until the payout is made, no money has moved. Optional so
    // positional test harnesses keep working; absent means no Books settlement
    // (the documents stay open, which is the old behaviour, not a crash).
    @Optional()
    private readonly zoho?: ZohoBooksService,
  ) {}

  /**
   * Settle the seller's Books documents for a payout that actually happened.
   * Fire-and-forget: a Books outage must never fail a payout the bank accepted.
   */
  private settleSellerDocuments(transactionId: string): void {
    if (!this.zoho) return;
    void this.zoho
      .settlePayoutDocuments(transactionId)
      .catch((err: Error) =>
        this.logger.warn(
          `Books settlement after payout ${transactionId} failed: ${err.message}`,
        ),
      );
  }

  // ── Seller payout disbursement (Ozow + Peach) ───────────────────────
  // Operator-triggered (admin endpoint). Gathers the due seller payouts and
  // partitions each row by the rail that captured the sale: Ozow rows go to
  // Ozow Payouts (one requestpayout per transaction), Peach rows go to Peach
  // Payouts (one batch). An atomic payout hold claims each row before the API
  // call. Accepted requests stamp payoutRequestedAt; status notifications /
  // polling stamp paidOutAt only on completion, or hold final failures for
  // review. Buyer refunds are NOT here: the gateway reverses those on the
  // original payment. There is NO cross-rail fallback.
  async runDuePayouts(): Promise<{
    attempted: number;
    accepted: number;
    failed: number;
    totalCents: number;
    skipped: SkippedDueRow[];
    byProvider: Record<
      'OZOW' | 'PEACH',
      { attempted: number; accepted: number; failed: number; totalCents: number }
    >;
  }> {
    if (!PAYMENTS_LIVE) {
      throw new Error(
        'Payments are not live (PAYMENTS_LIVE!=true) — payout disbursement is disabled.',
      );
    }
    if (!this.ozow.isPayoutsConfigured()) {
      throw new Error('Ozow Payouts API is not configured — refusing payout run.');
    }
    const due = await this.getPayoutsDue();
    const collected = await this.collectDue(due);
    const payable = due.payouts.filter((p) =>
      collected.payoutIds.includes(p.id),
    );
    const ozowPayable = payable.filter(
      (p) => p.paymentProvider !== PaymentProvider.PEACH,
    );
    const peachPayable = payable.filter(
      (p) => p.paymentProvider === PaymentProvider.PEACH,
    );
    if (payable.length === 0) {
      return {
        attempted: 0,
        accepted: 0,
        failed: 0,
        totalCents: 0,
        skipped: collected.skipped,
        byProvider: {
          OZOW: { attempted: 0, accepted: 0, failed: 0, totalCents: 0 },
          PEACH: { attempted: 0, accepted: 0, failed: 0, totalCents: 0 },
        },
      };
    }

    const childrenSum = (c?: { buyerTotal: number }[] | null) =>
      (c ?? []).reduce((s, x) => s + x.buyerTotal, 0);

    // Ozow payouts: one requestpayout per seller. Rows whose bank can't be
    // mapped are skipped WITH a reason, never guessed.
    //
    // amountCents here is the GROSS net (before failure-charge recovery). The
    // charge slice can only be fixed inside the atomic claim below, because
    // that is where the reservation is written; docking it here would let the
    // preview and the real payout disagree.
    const notifyUrl = this.publicApiBase() + '/payments/webhook/ozow-payout';
    type Candidate = OzowPayoutBeneficiary & {
      sellerId: string;
      availableCents: number;
      orderReference: string | null;
    };
    const candidates: Candidate[] = [];
    for (const p of ozowPayable) {
      const availableCents = netPayoutCents({ ...p, chargeRecoveryCents: 0 });
      if (availableCents <= 0) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: 'Net payout is zero after refunds/shipment charges — nothing to disburse',
        });
        continue;
      }
      const bank = normaliseOzowBank(p.seller.bankName) ?? bankByBranchCode(p.seller.bankBranchCode);
      if (!bank || !p.seller.bankAccountNumber || !p.seller.bankBranchCode) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? ''} bank "${p.seller.bankName ?? '—'}" is not recognised — ask them to re-pick their bank on /profile/edit`,
        });
        continue;
      }
      candidates.push({
        txId: p.id,
        merchantReference: `AO${p.id.replace(/[^a-zA-Z0-9]/g, '').slice(-18)}`,
        customerBankReference: (p.orderReference ?? `AO ${p.id.slice(-8)}`)
          .replace(/[^a-zA-Z0-9 -]/g, ' ')
          .trim()
          .slice(0, 20),
        accountHolder: p.seller.bankAccountHolder ?? '',
        bankAccountNumber: p.seller.bankAccountNumber,
        branchCode: p.seller.bankBranchCode,
        amountCents: availableCents,
        notifyUrl,
        sellerId: p.sellerId,
        availableCents,
        orderReference: p.orderReference ?? null,
      });
    }
    if (candidates.length === 0 && peachPayable.length === 0) {
      return {
        attempted: 0,
        accepted: 0,
        failed: 0,
        totalCents: 0,
        skipped: collected.skipped,
        byProvider: {
          OZOW: { attempted: 0, accepted: 0, failed: 0, totalCents: 0 },
          PEACH: { attempted: 0, accepted: 0, failed: 0, totalCents: 0 },
        },
      };
    }

    // Persist a per-attempt encrypted key and its signed request fields before
    // Ozow is called, then bind the returned payoutId for both callbacks.
    let accepted = 0;
    let attempted = 0;
    let totalCents = 0;
    const failures: string[] = [];
    for (const candidate of candidates) {
      // Claim the due row and reserve the recoverable charge slice in ONE
      // transaction, so a payout is never sent without its reservation (or a
      // reservation written without a payout).
      const now = new Date();
      let applied = 0;
      const claimed = await this.prisma.$transaction(async (txc) => {
        const claim = await txc.transaction.updateMany({
          where: {
            id: candidate.txId,
            releasedAt: { not: null },
            payoutRequestedAt: null,
            paidOutAt: null,
            payoutHeldAt: null,
          },
          data: {
            payoutHeldAt: now,
            payoutHoldReason: 'Ozow payout request in progress',
            payoutHeldById: null,
          },
        });
        if (claim.count === 0) return false;
        applied = await reserveSellerChargesForPayout(txc, {
          sellerId: candidate.sellerId,
          transactionId: candidate.txId,
          availableCents: candidate.availableCents,
        });
        return true;
      });
      if (!claimed) continue;

      const amountCents = Math.max(0, candidate.availableCents - applied);
      if (amountCents === 0) {
        // The payout is fully consumed by the recovered costs. The seller is
        // owed nothing on this sale, the debt shrinks by the full payout, and
        // no bank payment is made. Stamp it so it leaves the due queue.
        await this.prisma.$transaction(async (txc) => {
          await settleSellerChargeRecoveries(txc, candidate.txId);
          await txc.transaction.updateMany({
            where: { id: candidate.txId, paidOutAt: null },
            data: {
              paidOutAt: now,
              payoutRequestedAt: null,
              payoutHeldAt: null,
              payoutHoldReason: null,
              payoutHeldById: null,
            },
          });
        });
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: candidate.orderReference ?? candidate.txId,
          reason: `Payout fully recovered against seller charges (R${(applied / 100).toFixed(2)}); settled without a bank payment`,
        });
        // No bank payment, but the seller's debt was discharged: their
        // commission and re-weigh invoices are settled by the retention.
        this.settleSellerDocuments(candidate.txId);
        continue;
      }

      attempted += 1;
      const b: OzowPayoutBeneficiary = {
        txId: candidate.txId,
        merchantReference: candidate.merchantReference,
        customerBankReference: candidate.customerBankReference,
        accountHolder: candidate.accountHolder,
        bankAccountNumber: candidate.bankAccountNumber,
        branchCode: candidate.branchCode,
        amountCents,
        notifyUrl: candidate.notifyUrl,
      };

      let res: OzowPayoutResult;
      let persistedAttemptId: string | undefined;
      try {
        res = await this.ozow.createPayout(b, async (material) => {
          const attempt = await this.prisma.ozowPayoutAttempt.create({
            data: {
              transactionId: material.txId,
              siteCode: material.siteCode,
              merchantReference: material.merchantReference,
              customerBankReference: material.customerBankReference,
              amountCents: material.amountCents,
              isRtc: material.isRtc,
              notifyUrl: material.notifyUrl,
              bankGroupId: material.bankGroupId,
              encryptedAccountNumber: material.encryptedAccountNumber,
              branchCode: material.branchCode,
              encryptionKeyCiphertext: material.ciphertext,
              encryptionKeyIv: material.iv,
              encryptionKeyAuthTag: material.authTag,
            },
            select: { id: true },
          });
          persistedAttemptId = attempt.id;
          return attempt.id;
        });
      } catch (err) {
        const name = (err as Error).name || 'Error';
        const message = `Ozow request outcome unknown (${name}); held for reference reconciliation`;
        if (persistedAttemptId) {
          await this.prisma.ozowPayoutAttempt.update({
            where: { id: persistedAttemptId },
            data: { requestErrorMessage: message },
          }).catch(() => undefined);
        }
        failures.push(`${b.txId.slice(0, 8)}: ${message}`);
        await this.holdFailedPayout(b.txId, message, !!persistedAttemptId);
        // A request that never reached the gateway cannot have paid the
        // seller, so free the withheld slice. If an attempt row WAS persisted
        // the payout may be in flight — leave the reservation in place and let
        // the status webhook settle or release it.
        if (!persistedAttemptId) {
          await releaseSellerChargeRecoveries(this.prisma, b.txId);
        }
        continue;
      }

      if (res.accepted && res.payoutId && res.attemptId) {
        await this.prisma.$transaction([
          this.prisma.transaction.update({
            where: { id: b.txId },
            data: {
              gatewayPayoutId: res.payoutId,
              payoutRequestedAt: new Date(),
              payoutHeldAt: null,
              payoutHoldReason: null,
              payoutHeldById: null,
            },
          }),
          this.prisma.ozowPayoutAttempt.update({
            where: { id: res.attemptId },
            data: {
              gatewayPayoutId: res.payoutId,
              requestStatus: res.status,
              requestSubStatus: res.subStatus,
              requestErrorMessage: res.errorMessage || null,
            },
          }),
        ]);
        accepted += 1;
        totalCents += b.amountCents;
        // The payout exists now, so the seller-side documents it settles can be
        // discharged in Books.
        this.settleSellerDocuments(b.txId);
      } else {
        const reason = res.errorMessage ?? 'Ozow rejected the payout request';
        if (res.attemptId) {
          await this.prisma.ozowPayoutAttempt.update({
            where: { id: res.attemptId },
            data: {
              requestStatus: res.status,
              requestSubStatus: res.subStatus,
              requestErrorMessage: reason,
              lastStatus: res.status,
              lastSubStatus: res.subStatus,
              lastStatusMessage: reason,
              lastStatusCheckedAt: new Date(),
              terminalAt: new Date(),
            },
          });
        }
        failures.push(`${b.txId.slice(0, 8)}: ${reason}`);
        await this.holdFailedPayout(b.txId, reason);
        // Ozow refused the request outright: no payout happened, so the
        // charge must go back on the books for the next payout.
        await releaseSellerChargeRecoveries(this.prisma, b.txId);
      }
    }

    const failed = attempted - accepted;
    if (failed > 0) {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'OZOW_PAYOUT_PARTIAL',
            referenceId: `payout-${new Date().toISOString().slice(0, 10)}`,
            urgent: true,
            context: `Ozow payout run: ${accepted}/${attempted} accepted, ${failed} not accepted. ${failures.join('; ')}`,
          },
        })
        .catch(() => undefined);
    }
    this.logger.log(
      `Ozow payout run: ${accepted}/${attempted} accepted, R${Math.round(totalCents / 100)} submitted`,
    );
    const peach = await this.runPeachPayouts(peachPayable, collected);
    return {
      attempted: attempted + peach.attempted,
      accepted: accepted + peach.accepted,
      failed: failed + peach.failed,
      totalCents: totalCents + peach.totalCents,
      skipped: collected.skipped,
      byProvider: {
        OZOW: { attempted, accepted, failed, totalCents },
        PEACH: peach,
      },
    };
  }

  /**
   * Peach seller disbursement. Runs as one batch, but the per-row claim +
   * seller-charge reservation is the same as Ozow's. `paidOutAt` is only set
   * on a successful result/webhook; pending/processing stays in flight.
   */
  private async runPeachPayouts(
    payable: Awaited<ReturnType<ManualPaymentsService['getPayoutsDue']>>['payouts'],
    collected: { skipped: SkippedDueRow[] },
  ): Promise<{
    attempted: number;
    accepted: number;
    failed: number;
    totalCents: number;
  }> {
    const empty = { attempted: 0, accepted: 0, failed: 0, totalCents: 0 };
    if (payable.length === 0) return empty;
    const enabled =
      !!this.peach?.isPayoutsConfigured() &&
      (await this.settings.get(FLAGS.peachPayoutsEnabled));
    if (!enabled) {
      for (const p of payable) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason:
            'Peach payouts are not enabled/configured — this Peach-paid row stays queued and is never routed to Ozow',
        });
      }
      return empty;
    }

    type PeachCandidate = PeachPayoutBeneficiary & {
      txId: string;
      sellerId: string;
      availableCents: number;
      orderReference: string | null;
    };
    const candidates: PeachCandidate[] = [];
    const now = new Date();

    for (const p of payable) {
      const availableCents = netPayoutCents({ ...p, chargeRecoveryCents: 0 });
      if (availableCents <= 0) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: 'Net payout is zero after refunds/shipment charges — nothing to disburse',
        });
        continue;
      }
      const bank = normaliseBankName(p.seller.bankName);
      const branchCode = bank ? universalBranchCodeFor(bank) : null;
      if (
        !bank ||
        !branchCode ||
        !p.seller.bankAccountNumber ||
        !p.seller.bankAccountHolder
      ) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? ''} bank "${p.seller.bankName ?? '—'}" is not payable by Peach (${bank ? 'no universal branch code' : 'unrecognised bank'}) — ask them to re-pick their bank on /profile/edit`,
        });
        continue;
      }
      if (availableCents < 1000) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Amount R${(availableCents / 100).toFixed(2)} is below Peach's R10 payout minimum — held until combined with a later payout`,
        });
        continue;
      }

      const payoutId = randomUUID();
      let applied = 0;
      let amountCents = 0;
      const claimed = await this.prisma.$transaction(async (txc) => {
        const claim = await txc.transaction.updateMany({
          where: {
            id: p.id,
            releasedAt: { not: null },
            payoutRequestedAt: null,
            paidOutAt: null,
            payoutHeldAt: null,
          },
          data: {
            payoutHeldAt: now,
            payoutHoldReason: 'Peach payout request in progress',
            payoutHeldById: null,
          },
        });
        if (claim.count === 0) return false;
        applied = await reserveSellerChargesForPayout(txc, {
          sellerId: p.sellerId,
          transactionId: p.id,
          availableCents,
        });
        amountCents = Math.max(0, availableCents - applied);
        if (amountCents === 0) {
          await settleSellerChargeRecoveries(txc, p.id);
          await txc.transaction.updateMany({
            where: { id: p.id, paidOutAt: null },
            data: {
              paidOutAt: now,
              payoutRequestedAt: null,
              payoutHeldAt: null,
              payoutHoldReason: null,
              payoutHeldById: null,
            },
          });
          return true;
        }
        await txc.peachPayoutAttempt.create({
          data: {
            transactionId: p.id,
            payoutId,
            amountCents,
            bankName: bank,
            branchCode,
            accountHolder: p.seller.bankAccountHolder ?? '',
            reference: (p.orderReference ?? `AO ${p.id.slice(-8)}`)
              .replace(/[^a-zA-Z0-9 ]/g, ' ')
              .trim()
              .slice(0, 20),
            status: 'REQUESTED',
          },
        });
        return true;
      });
      if (!claimed) continue;
      if (amountCents === 0) {
        collected.skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Payout fully recovered against seller charges (R${(applied / 100).toFixed(2)}); settled without a bank payment`,
        });
        continue;
      }
      candidates.push({
        txId: p.id,
        sellerId: p.sellerId,
        availableCents,
        orderReference: p.orderReference ?? null,
        payoutId,
        bankName: bank,
        accountHolder: p.seller.bankAccountHolder ?? '',
        bankAccountNumber: p.seller.bankAccountNumber,
        branchCode,
        amountCents,
        reference: (p.orderReference ?? `AO ${p.id.slice(-8)}`)
          .replace(/[^a-zA-Z0-9 ]/g, ' ')
          .trim()
          .slice(0, 20),
        proofEmail: p.seller.email,
      });
    }

    if (candidates.length === 0) return empty;

    let res: Awaited<ReturnType<PeachService['createPayout']>>;
    try {
      res = await this.peach!.createPayout(candidates);
    } catch (err) {
      const message = `Peach payout request outcome unknown (${(err as Error).message})`;
      for (const c of candidates) {
        await this.prisma.peachPayoutAttempt
          .update({
            where: { payoutId: c.payoutId },
            data: { status: 'UNKNOWN', errorMessage: message },
          })
          .catch(() => undefined);
        await this.prisma.transaction.updateMany({
          where: { id: c.txId, paidOutAt: null },
          data: {
            payoutRequestedAt: now,
            payoutHeldAt: now,
            payoutHoldReason: 'Peach payout outcome unknown — reconcile before retrying',
            payoutHeldById: null,
          },
        });
      }
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'PEACH_PAYOUT_PARTIAL',
            referenceId: `payout-${new Date().toISOString().slice(0, 10)}`,
            urgent: true,
            context: `Peach payout run hit an unknown outcome for ${candidates.length} row(s). No charges were released; reconcile the payoutIds in the Peach dashboard. ${message}`,
          },
        })
        .catch(() => undefined);
      return { attempted: candidates.length, accepted: 0, failed: candidates.length, totalCents: 0 };
    }

    const byId = new Map(candidates.map((c) => [c.payoutId, c]));
    let accepted = 0;
    let totalCents = 0;
    const failures: string[] = [];
    for (const result of res.results) {
      const c = byId.get(result.payoutId);
      if (!c) continue;
      const status = result.status.toLowerCase();
      const isAccepted = ['pending', 'processing', 'successful', 'success'].includes(status);
      if (!isAccepted) {
        await this.prisma.peachPayoutAttempt.update({
          where: { payoutId: c.payoutId },
          data: {
            status: result.status,
            resultCode: result.code,
            errorMessage: result.error ?? result.code ?? result.status,
            terminalAt: now,
          },
        });
        await this.prisma.transaction.updateMany({
          where: { id: c.txId, paidOutAt: null },
          data: {
            payoutHeldAt: now,
            payoutHoldReason: `Peach payout rejected: ${result.error ?? result.code ?? result.status}`.slice(0, 500),
            payoutHeldById: null,
          },
        });
        await releaseSellerChargeRecoveries(this.prisma, c.txId);
        failures.push(`${c.txId.slice(0, 8)}: ${result.error ?? result.code ?? result.status}`);
        continue;
      }
      const successful = status === 'successful' || status === 'success';
      await this.prisma.$transaction([
        this.prisma.transaction.update({
          where: { id: c.txId },
          data: {
            gatewayPayoutId: c.payoutId,
            payoutRequestedAt: now,
            payoutHeldAt: null,
            payoutHoldReason: null,
            payoutHeldById: null,
            ...(successful ? { paidOutAt: now } : {}),
          },
        }),
        this.prisma.peachPayoutAttempt.update({
          where: { payoutId: c.payoutId },
          data: {
            status: result.status,
            requestId: res.requestId,
            resultCode: result.code,
            lastStatusCheckedAt: now,
            ...(successful ? { completedAt: now, terminalAt: now } : {}),
          },
        }),
      ]);
      if (successful) {
        await settleSellerChargeRecoveries(this.prisma, c.txId);
        // Same rule as the Ozow arm: the payout exists, so the seller's Books
        // documents can be discharged.
        this.settleSellerDocuments(c.txId);
      }
      accepted += 1;
      totalCents += c.amountCents;
    }

    // Any candidate Peach did not echo back is in an unknown state: keep it
    // held and let the status query/webhook reconcile it. Never mark it failed
    // or release its charge reservation.
    const returned = new Set(res.results.map((r) => r.payoutId));
    for (const c of candidates) {
      if (returned.has(c.payoutId)) continue;
      await this.prisma.peachPayoutAttempt
        .update({
          where: { payoutId: c.payoutId },
          data: { status: 'UNKNOWN', errorMessage: 'No result returned for this payoutId' },
        })
        .catch(() => undefined);
      await this.prisma.transaction.updateMany({
        where: { id: c.txId, paidOutAt: null },
        data: {
          payoutRequestedAt: now,
          payoutHeldAt: now,
          payoutHoldReason: 'Peach payout result missing — reconcile before retrying',
          payoutHeldById: null,
        },
      });
      failures.push(`${c.txId.slice(0, 8)}: no result`);
    }

    const failed = candidates.length - accepted;
    if (failed > 0) {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'PEACH_PAYOUT_PARTIAL',
            referenceId: res.requestId ?? `peach-${new Date().toISOString().slice(0, 10)}`,
            urgent: true,
            context: `Peach payout run: ${accepted}/${candidates.length} accepted, ${failed} not accepted. ${failures.join('; ')} ${res.message ?? ''}`.trim(),
          },
        })
        .catch(() => undefined);
    }
    this.logger.log(
      `Peach payout run: ${accepted}/${candidates.length} accepted, R${Math.round(totalCents / 100)} submitted`,
    );
    return { attempted: candidates.length, accepted, failed, totalCents };
  }

  private async holdFailedPayout(
    txId: string,
    reason: string,
    requestMayBeInFlight = false,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.transaction.updateMany({
      where: {
        id: txId,
        paidOutAt: null,
      },
      data: {
        ...(requestMayBeInFlight ? { payoutRequestedAt: now } : {}),
        payoutHeldAt: now,
        payoutHoldReason: `Ozow payout needs review: ${reason}`.slice(0, 500),
        payoutHeldById: null,
      },
    });
  }

  // Public /api origin for the payout notifyUrl (PUBLIC_API_URL, else
  // FRONTEND_URL + '/api', else localhost).
  private publicApiBase(): string {
    if (process.env.PUBLIC_API_URL)
      return process.env.PUBLIC_API_URL.replace(/\/$/, '');
    const fe = process.env.FRONTEND_URL;
    return fe ? `${fe.replace(/\/$/, '')}/api` : 'http://localhost:3001/api';
  }

  // ── P1.3 — Books failed-sync aggregate (read-only) ──────────────────
  // One place listing every entity whose latest Zoho sync FAILED, so the
  // operator doesn't have to trawl individual dossiers. Retry stays on
  // the per-transaction admin surface (ZB-10); this is the radar.
  async getZohoFailedSyncs() {
    const [transactions, subscriptionCharges, swaps] = await Promise.all([
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
        // SubscriptionCharge has no zohoSync* columns — a receipt failure
        // is recorded in errorMessage on a SUCCEEDED charge whose
        // zohoReceiptId never got set.
        //
        // ⚠️ AND NOTHING WRITES zohoReceiptId, so a row here cannot clear by
        // any code path that exists; the receipt has to be raised in Zoho by
        // hand. Only the transactions arm above has a repair
        // (POST /admin/transactions/:id/zoho-retry).
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
        // P1.3 — COMPLETED swaps that still owe a leg-fee Sales Receipt.
        // Swap has no zohoSync* columns, so the signal is a fee>0 side with a
        // null receipt id.
        //
        // 🚨 THIS COMMENT USED TO SAY THESE ARE "re-fired by the hourly
        // retryMissingSwapFeeReceipts cron". THAT CRON DOES NOT EXIST — grep
        // finds the name in this one comment and nowhere else in the repo —
        // and nothing anywhere writes zohoInitiatorFeeReceiptId or
        // zohoOwnerFeeReceiptId either. So a swap that lands in this arm stays
        // in it permanently, and the promise of an automatic retry would have
        // an operator wait for a repair that never runs. The Desk's Books lens
        // labels this arm "will not clear itself" for that reason.
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
    // The first-party purchase-order arm of this radar went with the feature.
    return {
      transactions,
      subscriptionCharges,
      swaps,
      totalFailed:
        transactions.length + subscriptionCharges.length + swaps.length,
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
        paidAt: { not: null },
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        refundOfId: null,
      },
      select: {
        sellerId: true,
        sellerPayout: true,
        // REQUIRED by netPayoutCents — omit it and the deduction is silently
        // zero, which looks exactly like a working payout.
        failedShipmentChargeCents: true,
        refundChildren: { select: { buyerTotal: true } },
      },
    });
    const owedBySeller = new Map<string, number>();
    for (const r of payoutRows) {
      const owed = Math.max(
        0,
        r.sellerPayout -
          childrenSum(r.refundChildren) -
          (r.failedShipmentChargeCents ?? 0),
      );
      owedBySeller.set(r.sellerId, (owedBySeller.get(r.sellerId) ?? 0) + owed);
    }
    let owedToSellersCents = [...owedBySeller.values()].reduce(
      (s, x) => s + x,
      0,
    );
    // Failure charges reduce what we still owe the seller, but never invert
    // the position into money owed to us on a payout run.
    for (const [sellerId, owed] of owedBySeller) {
      const charges = await outstandingSellerChargeCents(this.prisma, sellerId);
      owedToSellersCents -= Math.min(owed, charges);
    }
    const owedToSellers = {
      count: payoutRows.length,
      cents: Math.max(0, owedToSellersCents),
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
  // need the money sent back. "Due" = not paid (paidOutAt null), no payout
  // request already in flight (payoutRequestedAt null), and not held.
  async getPayoutsDue() {
    const payouts = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        paidAt: { not: null },
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        payoutRequestedAt: null,
        // P0.3 — synthetic refund children are never seller payouts.
        refundOfId: null,
        // M26 — a held row is withheld from the sweep until an admin clears
        // the hold (post-release fraud lever).
        payoutHeldAt: null,
      },
      orderBy: { releasedAt: 'asc' },
      select: {
        id: true,
        // The rail that captured the sale. The payout MUST use this provider.
        paymentProvider: true,
        // Needed to spread one seller's outstanding charges across their due
        // payouts (FIFO) instead of docking the full balance on each row.
        sellerId: true,
        orderReference: true,
        sellerPayout: true,
        // REQUIRED by netPayoutCents — omit it and the deduction is silently
        // zero, which looks exactly like a working payout.
        failedShipmentChargeCents: true,
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
            // BANV hard gate once Peach's Payouts/BANV product is configured:
            // collectDue skips a seller without this on both rails.
            bankVerifiedAt: true,
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
    // Spread each seller's outstanding failure charges across their due
    // payouts, oldest payout first. Read-only: the real reservation happens
    // atomically inside runDuePayouts. This is what the preview shows, and
    // netPayoutCents subtracts it everywhere.
    const outstanding = new Map<string, number>();
    for (const p of payouts) {
      if (!outstanding.has(p.sellerId)) {
        outstanding.set(
          p.sellerId,
          await outstandingSellerChargeCents(this.prisma, p.sellerId),
        );
      }
    }
    const remaining = new Map(outstanding);
    const payoutsWithCharges = payouts.map((p) => {
      const gross = netPayoutCents({ ...p, chargeRecoveryCents: 0 });
      const owed = remaining.get(p.sellerId) ?? 0;
      const chargeRecoveryCents = Math.min(gross, owed);
      remaining.set(p.sellerId, owed - chargeRecoveryCents);
      const amountCents = netPayoutCents({ ...p, chargeRecoveryCents });
      return { ...p, chargeRecoveryCents, amountCents };
    });
    return { payouts: payoutsWithCharges, refunds };
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
      // Eligibility is decided on the GROSS net (refunds + shipment charges),
      // because a row fully consumed by a seller charge still has to run so
      // the reservation can be settled. The payout total uses the NET.
      const grossPayout = netPayoutCents({ ...p, chargeRecoveryCents: 0 });
      const payoutAmount = netPayoutCents(p);
      if (grossPayout <= 0) {
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
      if (payoutAmount <= 0) {
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Nets to R0 after recovering R${(((p.chargeRecoveryCents ?? 0) / 100)).toFixed(2)} of seller charges — settled without a bank payment`,
        });
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
      // BANV hard gate. Once Peach BANV is configured it verifies the same
      // destination bank for BOTH rails (it checks account existence + SA-ID
      // ownership, not the gateway). A seller who has not passed stays held;
      // buyer refunds below are deliberately not gated.
      if (this.peach?.isBanvEnabled() && !p.seller.bankVerifiedAt) {
        skipped.push({
          kind: 'PAYOUT',
          ref: p.orderReference ?? p.id,
          reason: `Seller ${p.seller.username ?? '(no username)'}: bank account not yet verified (BANV) — re-save banking details or re-run verification from the dossier`,
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
    const autoPayoutsEnabled = await this.settings.get(
      FLAGS.autoPayoutsEnabled,
    );
    const peachPayinEnabled = await this.settings.get(FLAGS.peachPayinEnabled);
    const peachPayoutsEnabled = await this.settings.get(
      FLAGS.peachPayoutsEnabled,
    );
    const byProvider = {
      OZOW: { count: 0, amountCents: 0 },
      PEACH: { count: 0, amountCents: 0 },
    };
    for (const p of due.payouts) {
      const key =
        p.paymentProvider === PaymentProvider.PEACH ? 'PEACH' : 'OZOW';
      byProvider[key].count += 1;
      byProvider[key].amountCents += p.amountCents ?? 0;
    }
    // In-flight rows disappear from the due list while a payout is being
    // confirmed. Show them separately so the operator can see money that is
    // already moving.
    const inFlightRows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: 'RELEASED',
        paidAt: { not: null },
        sellerPayout: { gt: 0 },
        paidOutAt: null,
        payoutRequestedAt: { not: null },
        refundOfId: null,
      },
      select: { paymentProvider: true, sellerPayout: true },
    });
    const inFlight = {
      OZOW: { count: 0, amountCents: 0 },
      PEACH: { count: 0, amountCents: 0 },
    };
    for (const row of inFlightRows) {
      const key =
        row.paymentProvider === PaymentProvider.PEACH ? 'PEACH' : 'OZOW';
      inFlight[key].count += 1;
      inFlight[key].amountCents += row.sellerPayout;
    }
    return {
      ...due,
      skipped,
      autoPayoutsEnabled,
      peachPayinEnabled,
      peachPayoutsEnabled,
      byProvider,
      inFlight,
    };
  }
}
