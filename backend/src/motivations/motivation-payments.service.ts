import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MotivationPayment,
  MotivationPaymentStatus,
  MotivationStatus,
  PaymentProvider,
} from '@prisma/client';
import { DocumentEngineService } from '../common/document-filing/document-engine.service';
import { PAYMENTS_LIVE } from '../payments/payment-mode';
import { PaymentRailsService } from '../payments/payment-rails.service';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { MotivationActivityService } from './motivation-activity.service';
import { formatPrice } from './motivation-pricing';
import { MotivationQuotaService } from './motivation-quota.service';
import { EDITABLE, isPaidFor } from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// THE PAYGATE. R295, charged before the document is written.
//
// Operator, 2026-11-20: "On the motivations. I want to paygate it." — and, on
// the moment: pay at "Write my motivation", so nothing is generated before the
// money is in. That is the decision this file implements.
//
// WHY THERE IS NO NEW WEBHOOK SUBSCRIPTION. The marketplace already owns
// `/payments/webhook/ozow` inside the TransactionsService, and that handler
// matches a `Transaction` by merchant reference — it has no idea what a
// motivation is. Rather than teach the money-critical sale handler about a
// second product (and give it a dependency on this module), a motivation
// payment is confirmed by ASKING OZOW, twice: once when the member comes back
// from the bank, and again from a reconcile cron for the member who closes the
// tab. `getPaymentStatus` is the authority either way; the notification is only
// a shortcut.
//
// ⚠️ EVERY MONEY DECISION HERE IS TAKEN FROM THE GATEWAY'S ANSWER, never from
// the browser. The amount is compared to the snapshot on the attempt, the
// merchant reference is compared to ours, and the row is only marked paid if
// both bind. A mismatch does not fail quietly — it raises an AdminAlert, because
// money sitting at Ozow that we cannot match is the one state a human must see.
// ────────────────────────────────────────────────────────────────────

/** Statuses from which a document may still be prepared (or re-prepared). */
const PAYABLE_STATUSES: MotivationStatus[] = [
  ...EDITABLE,
  MotivationStatus.COMPLETED,
  MotivationStatus.FAILED,
];

/**
 * How long a created checkout is reused for a second click.
 *
 * Ozow's idempotency key is the merchant reference, and a fresh reference is a
 * fresh payment, so a double-tap would otherwise leave two live checkouts. Only
 * the one the member actually opens can be paid, but two rows for one intent is
 * noise support then has to read. Twenty minutes covers a real return trip to
 * the bank.
 */
const REUSE_ATTEMPT_MS = 20 * 60 * 1000;

/** An attempt older than this is dead: Ozow's own checkout expires at 24 h. */
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

/** How many pending attempts one reconcile run will query Ozow for. */
const RECONCILE_BATCH = 25;

/** Result codes that mean "this attempt will never succeed". */
const TERMINAL_RESULTS = ['cancel', 'fail', 'error', 'declin', 'expire'];

export interface MotivationPaymentState {
  /** True when this document must be paid for before it can be written. */
  required: boolean;
  /** True once the money is recorded against it. */
  paid: boolean;
  /** What it costs (or cost). Always whole cents. */
  amountCents: number;
  paidAt: string | null;
}

export interface MotivationCheckout {
  /** Where to send the browser. Null when there is nothing to pay. */
  redirectUrl: string | null;
  amountCents: number;
  alreadyPaid: boolean;
}

@Injectable()
export class MotivationPaymentsService {
  private readonly logger = new Logger(MotivationPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rails: PaymentRailsService,
    private readonly quota: MotivationQuotaService,
    // Books. A paid motivation is PRINCIPAL revenue, not an agent collection —
    // see createMotivationInvoice's own note.
    private readonly zoho: ZohoBooksService,
    // The support timeline: a payment that "went wrong" is the most expensive
    // report we get, so every step is recorded.
    private readonly activity: MotivationActivityService,
    // Jev-backed document engine; absent in old positional specs. The writer
    // treats it the same way.
    @Optional()
    private readonly engine?: DocumentEngineService,
  ) {}

  /** Is the paygate on? The kill switch, not the price. */
  async isPaidMode(): Promise<boolean> {
    return this.settings.get(FLAGS.motivationPaidEnabled);
  }

  /** The authoritative price for the NEXT checkout, in cents. */
  async priceCents(): Promise<number> {
    return this.settings.get(FLAGS.motivationPriceCents);
  }

  /** What the pack screen and the applications list need to render. */
  async state(row: {
    billedCents: number;
    paidAt: Date | null;
    betaSeatNo: number | null;
  }): Promise<MotivationPaymentState> {
    const paid = isPaidFor(row);
    const paidMode = await this.isPaidMode();
    return {
      // A row that already holds a free-beta seat stays free: it was given
      // away under the old rules and charging for it after the fact would be
      // billing somebody for a promise the product made.
      required: paidMode && !paid && row.betaSeatNo === null,
      paid,
      amountCents: paid ? row.billedCents : await this.priceCents(),
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    };
  }

  /**
   * The generation gate.
   *
   * Throws BEFORE the row is claimed GENERATING and before any model call, so
   * an unpaid attempt costs nothing. 409 with a machine-readable code, because
   * the pack page turns it back into the Pay button rather than a dead end.
   */
  async assertPaidForGeneration(userId: string, id: string): Promise<void> {
    if (!(await this.isPaidMode())) return;
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId },
      select: { referenceNumber: true, billedCents: true, betaSeatNo: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (isPaidFor(row) || row.betaSeatNo !== null) return;
    const price = await this.priceCents();
    void this.activity.record({
      motivationId: id,
      motivationRef: row.referenceNumber,
      userId,
      action: 'payment_required',
      detail: { priceCents: price },
    });
    throw new ConflictException({
      statusCode: 409,
      code: 'motivation-payment-required',
      message: `Pay ${formatPrice(price)} to write this motivation.`,
      priceCents: price,
    });
  }

  /**
   * Create (or hand back) the checkout for one application.
   *
   * Checks, in order, because each one is a reason NOT to take money: the
   * module is on, the paygate is on, the rail is live, this is the member's
   * document, it can still be written, the declaration is signed, and the
   * document engine is up. Charging before the declaration would take money
   * for a document the server then refuses to write.
   */
  async start(
    userId: string,
    id: string,
    frontendUrl: string,
  ): Promise<MotivationCheckout> {
    await this.quota.assertEnabled();
    if (!(await this.isPaidMode())) {
      throw new ConflictException({
        code: 'motivation-payments-not-enabled',
        message: 'Motivations are not being charged for right now.',
      });
    }
    if (!PAYMENTS_LIVE) {
      // Deliberately NOT the checkout copy ("card payments are launching
      // soon") — the member is nowhere near a shopping cart and the sentence
      // would be baffling.
      throw new ServiceUnavailableException({
        code: 'motivation-payments-not-live',
        message:
          'Payments for motivations are not open yet. You can still build your application and pay later.',
      });
    }

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        billedCents: true,
        paidAt: true,
        betaSeatNo: true,
        declarationAcceptedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    if (isPaidFor(row) || row.betaSeatNo !== null) {
      return {
        redirectUrl: null,
        amountCents: row.billedCents,
        alreadyPaid: true,
      };
    }

    if (!PAYABLE_STATUSES.includes(row.status)) {
      throw new ConflictException(
        'This document cannot be prepared again from here. Contact support.',
      );
    }
    if (!row.declarationAcceptedAt) {
      throw new ConflictException(
        'Please confirm the declaration before we prepare the document.',
      );
    }

    // No charge for a document we cannot write. Same check the writer makes,
    // and it must come BEFORE the checkout, not after it.
    await this.engine?.assertAvailable({
      userId,
      motivationId: id,
      action: 'GENERATE',
    });

    const amountCents = await this.priceCents();
    const reusable = await this.prisma.motivationPayment.findFirst({
      where: {
        motivationId: id,
        status: MotivationPaymentStatus.PENDING,
        amountCents,
        redirectUrl: { not: null },
        createdAt: { gt: new Date(Date.now() - REUSE_ATTEMPT_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable?.redirectUrl) {
      void this.activity.record({
        motivationId: id,
        motivationRef: row.referenceNumber,
        userId,
        action: 'payment_started',
        detail: { amountCents, reused: true },
      });
      return {
        redirectUrl: reusable.redirectUrl,
        amountCents: reusable.amountCents,
        alreadyPaid: false,
      };
    }

    let checkout;
    try {
      checkout = await this.rails.createCheckout(PaymentProvider.OZOW, {
        amountZarCents: amountCents,
        merchantTransactionId: row.id,
        returnUrl: `${frontendUrl.replace(/\/$/, '')}/licence-centre/${row.id}/pack?payment=return`,
      });
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: checkout create failed — ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not start the payment. Nothing has been charged — please try again.',
      );
    }

    await this.prisma.motivationPayment.create({
      data: {
        motivationId: row.id,
        userId,
        motivationRef: row.referenceNumber,
        amountCents,
        provider: checkout.provider,
        status: MotivationPaymentStatus.PENDING,
        gatewayCheckoutId: checkout.checkoutId,
        gatewayMerchantRef: checkout.merchantReference,
        redirectUrl: checkout.redirectUrl,
      },
    });

    void this.activity.record({
      motivationId: id,
      motivationRef: row.referenceNumber,
      userId,
      action: 'payment_started',
      detail: { amountCents, reused: false },
    });

    return {
      redirectUrl: checkout.redirectUrl,
      amountCents,
      alreadyPaid: false,
    };
  }

  /**
   * The member is back from the bank. Ask Ozow what actually happened.
   *
   * Never reports failure from a single negative answer: a capture can land a
   * few seconds after the browser returns, so the caller polls and this stays
   * honest about what it saw.
   */
  async verify(
    userId: string,
    id: string,
  ): Promise<{ paid: boolean; amountCents: number; status: string }> {
    const attempt = await this.prisma.motivationPayment.findFirst({
      where: {
        motivationId: id,
        userId,
        status: MotivationPaymentStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!attempt) {
      const row = await this.prisma.motivation.findFirst({
        where: { id, userId },
        select: { billedCents: true },
      });
      if (!row) throw new NotFoundException('Motivation not found');
      return {
        paid: row.billedCents > 0,
        amountCents: row.billedCents,
        status: row.billedCents > 0 ? 'PAID' : 'NONE',
      };
    }

    const settled = await this.settle(attempt);
    return {
      paid: settled === MotivationPaymentStatus.PAID,
      amountCents: attempt.amountCents,
      status: settled,
    };
  }

  /**
   * Sweep attempts nobody came back from.
   *
   * The member who pays and closes the tab must still end up with a paid
   * document — otherwise support has to reconcile by hand, and the entitlement
   * is invisible exactly when the member returns and presses Write.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePendingPayments(): Promise<void> {
    try {
      const now = Date.now();
      const stale = await this.prisma.motivationPayment.findMany({
        where: {
          status: MotivationPaymentStatus.PENDING,
          // Younger than two minutes is still in the member's hands; older
          // than a day is past Ozow's own checkout expiry.
          createdAt: {
            gt: new Date(now - ATTEMPT_TTL_MS),
            lt: new Date(now - 2 * 60 * 1000),
          },
        },
        orderBy: { createdAt: 'asc' },
        take: RECONCILE_BATCH,
      });

      for (const attempt of stale) {
        try {
          await this.settle(attempt);
        } catch (err) {
          this.logger.warn(
            `Motivation payment ${attempt.id}: reconcile failed — ${(err as Error).message}`,
          );
        }
      }

      const expired = await this.prisma.motivationPayment.updateMany({
        where: {
          status: MotivationPaymentStatus.PENDING,
          createdAt: { lte: new Date(now - ATTEMPT_TTL_MS) },
        },
        data: {
          status: MotivationPaymentStatus.FAILED,
          failedAt: new Date(),
        },
      });
      if (expired.count > 0) {
        this.logger.log(
          `Motivation payments: expired ${expired.count} abandoned checkout(s)`,
        );
      }
    } catch (err) {
      // A cron that throws is a cron that stops being scheduled in some
      // deployments, and this is the only path that settles an abandoned tab.
      this.logger.error(
        `Motivation payment reconcile failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Ask the gateway about one attempt and move it if the answer is final.
   *
   * Returns the status the row is in now. Network trouble and "still pending"
   * are both PENDING — the next sweep will ask again.
   */
  private async settle(
    attempt: MotivationPayment,
  ): Promise<MotivationPaymentStatus> {
    if (attempt.status !== MotivationPaymentStatus.PENDING)
      return attempt.status;
    if (!attempt.gatewayCheckoutId) return MotivationPaymentStatus.PENDING;

    let status;
    try {
      status = await this.rails.getPaymentStatus(
        attempt.provider,
        attempt.gatewayCheckoutId,
      );
    } catch (err) {
      this.logger.warn(
        `Motivation payment ${attempt.id}: status query failed — ${(err as Error).message}`,
      );
      return MotivationPaymentStatus.PENDING;
    }
    if (!status) return MotivationPaymentStatus.PENDING;

    if (!status.isSuccess) {
      const code = (status.resultCode ?? '').toLowerCase();
      if (TERMINAL_RESULTS.some((t) => code.includes(t))) {
        await this.prisma.motivationPayment.updateMany({
          where: { id: attempt.id, status: MotivationPaymentStatus.PENDING },
          data: {
            status: MotivationPaymentStatus.FAILED,
            failedAt: new Date(),
          },
        });
        return MotivationPaymentStatus.FAILED;
      }
      return MotivationPaymentStatus.PENDING;
    }

    // THE MONEY BINDING. The amount is the snapshot this attempt was created
    // for; a different number is not this application's payment, whatever the
    // member typed or whichever checkout they used.
    if (status.amountCents !== attempt.amountCents) {
      await this.alert(
        'MOTIVATION_PAYMENT_AMOUNT_MISMATCH',
        attempt,
        `Ozow reported ${status.amountCents}c for ${attempt.gatewayMerchantRef ?? attempt.id}, expected ${attempt.amountCents}c. Payment NOT applied.`,
        true,
      );
      return MotivationPaymentStatus.PENDING;
    }
    if (
      attempt.gatewayMerchantRef &&
      status.merchantReference &&
      attempt.gatewayMerchantRef.toLowerCase() !==
        status.merchantReference.toLowerCase()
    ) {
      await this.alert(
        'MOTIVATION_PAYMENT_REFERENCE_MISMATCH',
        attempt,
        `Ozow echoed merchant reference ${status.merchantReference}, expected ${attempt.gatewayMerchantRef}. Payment NOT applied.`,
        true,
      );
      return MotivationPaymentStatus.PENDING;
    }

    await this.markPaid(attempt, status.paymentId);
    return MotivationPaymentStatus.PAID;
  }

  /**
   * Record the capture.
   *
   * The `$transaction` is what makes two confirmations — the return call and
   * the cron, or two tabs — collapse into one: only the update from PENDING can
   * win, and only the winner writes `billedCents` on the motivation. A second
   * PAID row is money we took twice, and that is alerted rather than hidden.
   */
  private async markPaid(
    attempt: MotivationPayment,
    gatewayPaymentId: string,
  ): Promise<void> {
    const now = new Date();
    const siblingPaid = await this.prisma.$transaction(async (tx) => {
      const won = await tx.motivationPayment.updateMany({
        where: { id: attempt.id, status: MotivationPaymentStatus.PENDING },
        data: {
          status: MotivationPaymentStatus.PAID,
          paidAt: now,
          gatewayPaymentId,
        },
      });
      if (won.count === 0) return 0;

      const already = attempt.motivationId
        ? await tx.motivationPayment.count({
            where: {
              motivationId: attempt.motivationId,
              status: MotivationPaymentStatus.PAID,
              id: { not: attempt.id },
            },
          })
        : 0;

      if (attempt.motivationId) {
        await tx.motivationPayment.updateMany({
          where: {
            motivationId: attempt.motivationId,
            status: MotivationPaymentStatus.PENDING,
            id: { not: attempt.id },
          },
          data: { status: MotivationPaymentStatus.CANCELLED },
        });
        // ⚠️ `billedCents: 0` IN THE WHERE, NOT A BLIND WRITE. A regeneration
        // must never re-price a document that was already paid for, and a
        // second capture must not overwrite the first amount.
        await tx.motivation.updateMany({
          where: { id: attempt.motivationId, billedCents: 0 },
          data: { billedCents: attempt.amountCents, paidAt: now },
        });
      }
      return already;
    });

    this.logger.log(
      `Motivation payment ${attempt.id} captured for ${attempt.motivationRef} (${formatPrice(attempt.amountCents)})`,
    );

    void this.activity.record({
      motivationId: attempt.motivationId,
      motivationRef: attempt.motivationRef,
      userId: attempt.userId,
      action: 'payment_confirmed',
      detail: { amountCents: attempt.amountCents, provider: attempt.provider },
    });

    // ⚠️ BOOKS GETS THE PRINCIPAL SALE, AND IT DOES NOT BLOCK THIS REQUEST.
    // The money is already ours; the invoice is paperwork that must not make a
    // member wait on an accountant's API. createMotivationInvoice swallows its
    // own failures onto the payment row, and the hourly sweep retries them.
    void this.zoho.createMotivationInvoice(attempt.id).catch((err) => {
      this.logger.warn(
        `Zoho motivation invoice failed for ${attempt.id}: ${(err as Error).message}`,
      );
    });

    if (siblingPaid > 0) {
      await this.alert(
        'MOTIVATION_DOUBLE_PAYMENT',
        attempt,
        `${siblingPaid + 1} captured payments exist for ${attempt.motivationRef}. The member was charged more than once — refund all but one through Ozow.`,
        true,
      );
    }
  }

  private async alert(
    type: string,
    attempt: MotivationPayment,
    context: string,
    urgent = false,
  ): Promise<void> {
    await this.prisma.adminAlert
      .create({
        data: {
          type,
          referenceId: attempt.motivationId ?? attempt.id,
          urgent,
          context,
        },
      })
      .catch(() => undefined);
  }
}
