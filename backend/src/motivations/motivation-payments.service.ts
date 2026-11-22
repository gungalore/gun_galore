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
import { randomBytes } from 'crypto';
import { DocumentEngineService } from '../common/document-filing/document-engine.service';
import { PAYMENTS_LIVE } from '../payments/payment-mode';
import { PaymentRailsService } from '../payments/payment-rails.service';
import { YocoService } from '../payments/yoco.service';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { MotivationActivityService } from './motivation-activity.service';
import { formatPrice } from './motivation-pricing';
import { MotivationQuotaService } from './motivation-quota.service';
import { EDITABLE, isPaidFor } from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// THE PAYGATE. R295, charged before the document is written.
//
// Operator, 2026-11-20: "On the motivations. I want to paygate it." — and, on
// the moment: pay at "Write my motivation", so nothing is generated before the
// money is in.
//
// Operator, 2026-11-22: "We are removing it completely from zoho and moving
// over to yoco api ... no more peach and ozow, just yoco for motivation
// payments." New attempts are Yoco Checkout. The Zoho Books invoice is gone
// with it. Pending attempts created before the switch keep settling through
// whichever rail is ON THE ROW — a payment row is rail-locked for life.
//
// WHY THERE IS STILL A RECONCILE CRON. The member who pays and closes the tab
// must still end up with a paid document. The Yoco webhook is the fast path;
// `reconcilePendingPayments` is the one that cannot be missed.
//
// ⚠️ EVERY MONEY DECISION HERE IS TAKEN FROM THE GATEWAY'S ANSWER, never from
// the browser and never from a webhook body. The amount is compared to the
// snapshot on the attempt, the reference is compared to ours, and the row is
// only marked paid if both bind. A mismatch does not fail quietly — it raises
// an AdminAlert, because money sitting at the gateway that we cannot match is
// the one state a human must see.
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
 * A fresh reference is a fresh payment, so a double-tap would otherwise leave
 * two live checkouts. Only the one the member actually opens can be paid, but
 * two rows for one intent is noise support then has to read. Twenty minutes
 * covers a real return trip to the bank or a card 3-D Secure challenge.
 */
const REUSE_ATTEMPT_MS = 20 * 60 * 1000;

/** An attempt older than this is dead: the checkout expires with it. */
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

/** How many pending attempts one reconcile run will query the gateway for. */
const RECONCILE_BATCH = 25;

/** Statuses that mean "this attempt will never succeed". */
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

/** The parts of a Yoco Checkout webhook this service acts on. */
export interface YocoWebhookEvent {
  type?: string;
  payload?: {
    id?: string;
    amount?: number;
    status?: string;
    metadata?: Record<string, unknown> | null;
  };
}

@Injectable()
export class MotivationPaymentsService {
  private readonly logger = new Logger(MotivationPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rails: PaymentRailsService,
    private readonly quota: MotivationQuotaService,
    // The support timeline: a payment that "went wrong" is the most expensive
    // report we get, so every step is recorded.
    private readonly activity: MotivationActivityService,
    // Jev-backed document engine; absent in old positional specs. The writer
    // treats it the same way.
    @Optional()
    private readonly engine?: DocumentEngineService,
    // Only to log the test-key-in-production refusal with a reason. The rails
    // seam is what actually creates the checkout.
    @Optional()
    private readonly yoco?: YocoService,
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
    if (!PAYMENTS_LIVE || !(await this.rails.isPayInEnabled(PaymentProvider.YOCO))) {
      // Deliberately NOT the checkout copy ("card payments are launching
      // soon") — the member is nowhere near a shopping cart and the sentence
      // would be baffling.
      if (
        PAYMENTS_LIVE &&
        this.yoco?.isConfigured() &&
        this.yoco.isTestKey() &&
        process.env.NODE_ENV === 'production'
      ) {
        this.logger.error(
          'Motivation paygate refused: a Yoco TEST key is configured in production. Nothing can be charged until a live key is installed.',
        );
      }
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
        // ⚠️ Do not resurrect a pre-switch Ozow checkout: the paygate is Yoco
        // now, and an old hosted page is exactly what "no more ozow for
        // motivation payments" rules out.
        provider: PaymentProvider.YOCO,
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

    // A reference of our own. Yoco echoes it as `clientReferenceId` and in the
    // metadata, and it is the key every settlement path matches on. It must be
    // unique per ATTEMPT, not per application: `gatewayMerchantRef` is unique
    // and a member may legitimately open a second checkout after the first.
    const reference = `${row.referenceNumber}-${randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;

    let checkout;
    try {
      checkout = await this.rails.createCheckout(PaymentProvider.YOCO, {
        amountZarCents: amountCents,
        merchantTransactionId: reference,
        returnUrl: `${frontendUrl.replace(/\/$/, '')}/licence-centre/${row.id}/pack?payment=return`,
        expirySeconds: Math.floor(ATTEMPT_TTL_MS / 1000),
        metadata: {
          motivationId: row.id,
          motivationRef: row.referenceNumber,
          reference,
        },
      });
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: checkout create failed — ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not start the payment. Nothing has been charged — please try again.',
      );
    }

    if (
      checkout.mode === 'test' &&
      process.env.NODE_ENV === 'production'
    ) {
      this.logger.warn(
        `Motivation ${row.id}: TEST-mode checkout created in production (YOCO_ALLOW_TEST_IN_PRODUCTION is on). No real money will be taken.`,
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
        gatewayMode: checkout.mode ?? null,
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
   * The member is back from the payment page. Ask the gateway what happened.
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
   * The Yoco webhook, as a hint.
   *
   * The controller has already checked the signature. This finds the attempt
   * the event points at and then RE-READS the checkout from Yoco — the event
   * body is never trusted for an amount or a status. Unknown references are
   * logged and ignored: a webhook for something we cannot find must not 500,
   * or Yoco will retry it forever.
   */
  async handleYocoEvent(event: YocoWebhookEvent): Promise<void> {
    const metadata = event.payload?.metadata ?? null;
    const topLevelRef = (
      event.payload as { clientReferenceId?: unknown } | undefined
    )?.clientReferenceId;
    const reference =
      typeof metadata?.['reference'] === 'string'
        ? metadata['reference']
        : typeof metadata?.['clientReferenceId'] === 'string'
          ? metadata['clientReferenceId']
          : typeof topLevelRef === 'string'
            ? topLevelRef
            : null;
    // Yoco also injects the checkout id into metadata; it is a second way to
    // find the attempt if our own key ever goes missing from the echo.
    const checkoutId =
      typeof metadata?.['checkoutId'] === 'string'
        ? metadata['checkoutId']
        : null;
    let attempt = reference
      ? await this.prisma.motivationPayment.findFirst({
          where: { gatewayMerchantRef: reference },
        })
      : null;
    if (!attempt && checkoutId) {
      attempt = await this.prisma.motivationPayment.findFirst({
        where: { gatewayCheckoutId: checkoutId },
      });
    }
    if (!attempt) {
      this.logger.warn(
        `Yoco webhook ${event.type ?? 'unknown'}: ${reference ?? checkoutId ?? 'no reference'} matches no motivation payment — ignored`,
      );
      return;
    }
    if (
      metadata?.['motivationId'] &&
      attempt.motivationId &&
      metadata['motivationId'] !== attempt.motivationId
    ) {
      await this.alert(
        'MOTIVATION_PAYMENT_REFERENCE_MISMATCH',
        attempt,
        `Yoco webhook reference ${reference ?? checkoutId} claims motivation ${String(metadata['motivationId'])}, but the payment belongs to ${attempt.motivationId}. Payment NOT applied.`,
        true,
      );
      return;
    }
    await this.settle(attempt);
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
          // than a day is past the checkout expiry we asked the gateway for.
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

    // ⚠️ TEST MONEY IS NOT REVENUE. A test-mode capture would otherwise mark a
    // document paid and write it for money that never arrived. The only
    // exception is the deliberate production test window the operator opened
    // with YOCO_ALLOW_TEST_IN_PRODUCTION — and even then the capture is
    // flagged, so it can never be read as a real sale later.
    if (status.mode === 'test' && process.env.NODE_ENV === 'production') {
      if (!this.yoco?.allowsTestInProduction()) {
        await this.alert(
          'MOTIVATION_PAYMENT_TEST_MODE',
          attempt,
          `The gateway reports a TEST-mode capture for ${attempt.motivationRef}. Payment NOT applied — install a live key.`,
          true,
        );
        return MotivationPaymentStatus.PENDING;
      }
      await this.alert(
        'MOTIVATION_PAYMENT_TEST_MODE_APPLIED',
        attempt,
        `TEST-mode capture applied to ${attempt.motivationRef} under YOCO_ALLOW_TEST_IN_PRODUCTION. This document was written for test money; do not treat it as revenue.`,
        false,
      );
    }

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
        `The gateway reported ${status.amountCents}c for ${attempt.gatewayMerchantRef ?? attempt.id}, expected ${attempt.amountCents}c. Payment NOT applied.`,
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
        `The gateway echoed reference ${status.merchantReference}, expected ${attempt.gatewayMerchantRef}. Payment NOT applied.`,
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
   * the cron, or two tabs, or the webhook and the cron — collapse into one:
   * only the update from PENDING can win, and only the winner writes
   * `billedCents` on the motivation. A second PAID row is money we took twice,
   * and that is alerted rather than hidden.
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

    if (siblingPaid > 0) {
      await this.alert(
        'MOTIVATION_DOUBLE_PAYMENT',
        attempt,
        `${siblingPaid + 1} captured payments exist for ${attempt.motivationRef}. The member was charged more than once — refund all but one through Yoco.`,
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

  /**
   * A webhook whose signature did not verify. Called by the controller so a
   * forged delivery leaves a trace even though it receives a 200.
   */
  async reportWebhookRejected(reason: string): Promise<void> {
    await this.prisma.adminAlert
      .create({
        data: {
          type: 'YOCO_WEBHOOK_SIGNATURE_INVALID',
          referenceId: 'payments/webhook/yoco',
          urgent: false,
          context: `A Yoco webhook was rejected: ${reason}. Nothing was applied; the reconcile cron remains the authority.`,
        },
      })
      .catch(() => undefined);
  }
}
