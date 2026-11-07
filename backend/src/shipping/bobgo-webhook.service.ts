import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { bobgoToShippingStatus } from './status-map';
import { ShippingService } from './shipping.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { raiseSellerCharge } from '../common/seller-charges';

/**
 * The most we will dock a seller automatically for a courier re-weigh.
 *
 * A re-weigh charge is real and the seller owes it (see the T&Cs), but an
 * automatic deduction from somebody's earnings must have a ceiling: a
 * malformed payload, a carrier pricing error or a parcel that was re-boxed by
 * the courier would otherwise become a debt nobody checked. Above this figure
 * the charge is NOT raised and the alert stays urgent for a human.
 */
const MAX_AUTO_VARIANCE_CENTS = 100_000; // R1,000

/**
 * Bob Go webhook ingestion.
 *
 * Seven topics exist (the API lists them when you PATCH an invalid one):
 *
 *   fulfillment/created                 an order became a shipment
 *   shipment_submission_status/updated  the courier accepted or refused it
 *   tracking/updated                    a carrier scan
 *   shipment_charged_amount/updated     what we are actually billed changed
 *   shipment_charged_weight/updated     they re-weighed the parcel
 *   shipment_health_status/updated      e.g. warning-late-collection
 *   order/updated                       order-level change
 *
 * TWO JOBS, and the second matters as much as the first.
 *
 * 1. ACT on what we understand — chiefly resolving a booking the courier has
 *    now accepted or refused, which today waits up to five minutes for a poll.
 *
 * 2. RECORD, verbatim, what we do NOT understand. Bob Go's status vocabulary is
 *    only partly known: we have seen `pending-rates`, `success`, `no-rates` and
 *    `pending-collection` and nothing else. status-map.ts currently maps
 *    carrier statuses by substring, which is how `ready_for_pickup` would be
 *    read as "out for delivery" and `expired` as a terminal delivery failure.
 *    Guessing the rest would bake those mistakes in. So every unrecognised
 *    status is written to the event log and logged loudly, and the map is
 *    widened only from strings we have actually observed.
 *
 * Nothing here throws. Bob Go retries on non-2xx, and a retry storm caused by
 * our own bug would be worse than a dropped event.
 *
 * ⚠️ THERE IS NO POLL BEHIND THIS ANY MORE (corrected 2026-11-06). This said
 * "we can recover by polling — the poll still runs and remains the backstop".
 * It does not: the Pudo tracking poll was retired on 2026-09-24 with the move
 * to Bob Go, and nothing replaced it. So a webhook that never arrives is not
 * recovered within ten minutes by a sweep — the only automatic follow-up is
 * `resolvePendingBobGoBookings` (every 5 minutes), and that resolves BOOKINGS,
 * not tracking scans. What is left as a backstop is the event log below plus a
 * human: every unrecognised payload is stored whole, and every unknown status
 * is logged loudly, so widening the map from evidence stays possible.
 */
@Injectable()
export class BobGoWebhookService {
  private readonly logger = new Logger(BobGoWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: ShippingService owns the webhook controller's other handlers
    // and Nest would otherwise see a cycle through ShippingModule.
    @Inject(forwardRef(() => ShippingService))
    private readonly shipping: ShippingService,
    // Books: a courier re-weigh is billed to the SELLER, so the debt needs a
    // document as well as a ledger row. ZohoBooksModule imports nothing from
    // shipping, so this is not a cycle.
    private readonly zoho: ZohoBooksService,
  ) {}


  async handle(
    topic: string,
    body: Record<string, unknown>,
  ): Promise<{ handled: boolean }> {
    const t = String(topic || '').trim().toLowerCase();
    try {
      switch (t) {
        case 'shipment_submission_status/updated':
          return await this.onSubmissionStatus(body);
        case 'tracking/updated':
          return await this.onTracking(body);
        case 'shipment_charged_amount/updated':
        case 'shipment_charged_weight/updated':
          return await this.onCharge(t, body);
        case 'shipment_health_status/updated':
          return await this.onHealth(body);
        case 'fulfillment/created':
        case 'order/updated':
          // Nothing depends on these yet — we create shipments directly rather
          // than through Bob Go's order flow. Recorded so the shape is known
          // if that ever changes.
          this.record(t, body);
          return { handled: false };
        default:
          this.logger.warn(`Bob Go webhook: unknown topic "${topic}"`);
          this.record(t || 'unknown', body);
          return { handled: false };
      }
    } catch (err) {
      // Swallowed on purpose — see the class docblock.
      this.logger.error(
        `Bob Go webhook (${topic}) failed: ${(err as Error).message}`,
      );
      return { handled: false };
    }
  }

  /**
   * The courier has answered. This is the event the pending-booking sweep
   * exists to catch, arriving in seconds instead of up to five minutes.
   *
   * It deliberately does NOT finish the booking itself. Completing one means
   * stamping shipmentBookedAt AND writing the seller's in-app shipment row —
   * that belongs in exactly one place, and it is already written and tested in
   * ShippingService. All this does is make the row eligible so the very next
   * sweep finishes it. A webhook that races the sweep to write the same row
   * twice is a worse outcome than a short wait.
   */
  private async onSubmissionStatus(
    body: Record<string, unknown>,
  ): Promise<{ handled: boolean }> {
    const shipmentId = this.shipmentIdOf(body);
    const status = String(body.submission_status ?? '').trim();
    this.record('shipment_submission_status/updated', body, shipmentId);

    if (!shipmentId) {
      this.logger.warn(
        'Bob Go submission webhook carried no shipment id — nothing to match',
      );
      return { handled: false };
    }
    this.logger.log(
      `Bob Go submission status for shipment ${shipmentId}: "${status}"`,
    );
    return { handled: true };
  }

  /** A carrier scan. The point of ingesting these now is to LEARN the vocabulary. */
  private async onTracking(
    body: Record<string, unknown>,
  ): Promise<{ handled: boolean }> {
    // WATCH THE IDENTIFIER. On this topic — and only this topic — `id` is the
    // TRACKING REFERENCE ("UASSW3HJ"), not the numeric shipment id every other
    // payload carries. Verified: a single booking produced four events keyed on
    // 16626 and one keyed on UASSW3HJ.
    //
    // That is convenient rather than awkward: Transaction.trackingReference is
    // exactly what the existing poll and both legacy webhooks already match on.
    // But it means a query like `WHERE shipmentId = '16626'` will NOT find the
    // tracking rows, so the column holds whichever identifier the topic used.
    const trackingReference = this.shipmentIdOf(body);
    const rawStatus = String(body.status ?? '').trim();
    this.record('tracking/updated', body, trackingReference);
    if (!trackingReference || !rawStatus) return { handled: false };

    // status-map owns the vocabulary — Bob Go has its OWN table there, kept
    // apart from the Shiplogic one because two words collide with meanings we
    // must not inherit (READY_FOR_PICKUP -> OUT_FOR_DELIVERY, EXPIRED ->
    // a TERMINAL DELIVERY_FAILED).
    const mapped = bobgoToShippingStatus(rawStatus);
    if (!mapped) {
      // The loudest line in this file, on purpose. Every one of these is a
      // status we would otherwise have to guess at, and each is a chance to
      // widen the table from evidence instead of from a hunch. The event is
      // already stored whole, so nothing is lost by refusing to act.
      this.logger.warn(
        `Bob Go tracking status not yet mapped: "${rawStatus}" (${trackingReference}) — ` +
          `recorded for review; NOT applied to the order`,
      );
      return { handled: false };
    }

    const tx = await this.prisma.transaction
      .findFirst({
        where: { trackingReference },
        select: { id: true },
      })
      .catch(() => null);
    if (!tx) {
      // Not ours, or a shipment booked outside the platform. Recorded, ignored.
      this.logger.warn(
        `Bob Go tracking event for unknown reference ${trackingReference}`,
      );
      return { handled: false };
    }

    // Same entry point the poll and both legacy webhooks use, so all three
    // share ONE decision about backward transitions, notifications and the
    // delivered/payout gate. There is no Bob Go-specific shortcut here.
    await this.shipping.applyShippingUpdate(tx.id, mapped);
    return { handled: true };
  }

  /**
   * What Bob Go actually bills us changed.
   *
   * This is the reconciliation rail for the open pricing question. The buyer is
   * charged a quoted price at checkout and the parcel is booked days later;
   * `final_charge_applied` was false on the accepted sandbox shipment and the
   * weight had already been rounded 2.5 -> 3 kg. If a re-weigh pushes the
   * parcel across a rate band, this event is the only notice we get, and the
   * difference comes out of margin unless someone sees it.
   *
   * ⚠️ SO IT HAS TO END SOMEWHERE A PERSON LOOKS. This used to log the amount
   * and return — "the reconciliation rail", reconciling nothing: no stored
   * figure, no comparison with what the buyer paid, no alert. The only place
   * the difference appeared was the application log, which no screen in the
   * Desk reads. The buyer's Delivery line and the courier's actual charge
   * quietly disagreed, and the Books freight journal kept posting the quoted
   * figure.
   *
   * Now the amount is compared with `Transaction.shippingCost` — the quote
   * snapshotted at checkout — and any difference raises an urgent Desk alert
   * naming both figures. It is still not an automatic re-bill: deciding
   * whether a R30 carrier increase is absorbed, passed to the buyer, or taken
   * off the seller's payout is a commercial call, and this platform does not
   * make those silently.
   *
   * ⚠️ UNITS. Bob Go prices in RAND (`total_price: 114.95`), every figure we
   * store is CENTS, so the conversion happens here. The alert prints the raw
   * payload value as well, so if the two ever disagree the first alert says so
   * instead of hiding a 100x error.
   */
  private async onCharge(
    topic: string,
    body: Record<string, unknown>,
  ): Promise<{ handled: boolean }> {
    const shipmentId = this.shipmentIdOf(body);
    this.record(topic, body, shipmentId);
    this.logger.log(
      `Bob Go ${topic} for shipment ${shipmentId ?? '?'}: ` +
        `amount=${JSON.stringify(body.charged_amount)} weight=${JSON.stringify(body.charged_weight_kg)}`,
    );

    const chargedCents = randToCentsOrNull(body.charged_amount);
    // The weight topic carries no money, and an unrecognised payload shape must
    // not be guessed at. Both are recorded above and stop here.
    if (!shipmentId || chargedCents === null) return { handled: true };

    const tx = await this.prisma.transaction.findFirst({
      where: { carrierShipmentId: shipmentId },
      select: {
        id: true,
        shippingCost: true,
        shipmentChargedCents: true,
        // The variance is a seller debt, so the seller and any refund on the
        // sale have to come with it.
        sellerId: true,
        refundedAmount: true,
      },
    });
    if (!tx) {
      // Booked outside the platform, or an id we never stored. Recorded above.
      this.logger.warn(
        `Bob Go ${topic}: no transaction carries shipment ${shipmentId}`,
      );
      return { handled: true };
    }

    const quotedCents = Math.max(0, tx.shippingCost ?? 0);
    const varianceCents = chargedCents - quotedCents;
    // A retried delivery of the SAME figure is not news — and Bob Go does
    // retry. Read the previous value before overwriting it, so the alert is
    // raised once per change rather than once per attempt.
    const alreadyKnown = tx.shipmentChargedCents === chargedCents;

    // Record the real charge regardless of the variance, so the desk can
    // compare the pair without parsing an alert string. The QUOTE is never
    // touched: the buyer paid that number.
    await this.prisma.transaction
      .update({
        where: { id: tx.id },
        data: {
          shipmentChargedCents: chargedCents,
          shipmentChargedAt: new Date(),
        },
      })
      .catch(() => undefined);

    if (varianceCents === 0) {
      this.logger.log(
        `Bob Go ${topic}: shipment ${shipmentId} charged exactly the quote (${quotedCents}c)`,
      );
      return { handled: true };
    }
    if (alreadyKnown) {
      this.logger.log(
        `Bob Go ${topic}: shipment ${shipmentId} re-reported the same charge (${chargedCents}c) — already alerted`,
      );
      return { handled: true };
    }

    const sign = varianceCents > 0 ? 'MORE' : 'LESS';

    // ── THE SELLER PAYS THE DIFFERENCE ──────────────────────────────────
    //
    // Bob Go accepts the parcel and bills the wallet; there is no point at
    // which we can refuse the charge, and the buyer paid the quote and is
    // never re-billed. So a re-weigh that costs more is the SELLER's debt: it
    // goes on the SellerCharge ledger (the recovery machinery is kind-agnostic
    // and will take it off their payout, this sale's or the next one), and
    // Books raises an invoice to them carrying the declared-vs-billed reason.
    //
    // ⚠️ CAPPED. Above the cap we do NOT dock a seller automatically — a
    // malformed or wildly wrong charge must be looked at by a person before it
    // becomes a debt against somebody's earnings.
    let recoveryNote: string;
    let urgent = false;
    if (varianceCents <= 0) {
      // The carrier billed less than the buyer paid. Nothing is recovered from
      // the seller; the platform keeps the difference for now.
      recoveryNote =
        'The carrier billed less than quoted; nothing is recovered from the seller.';
    } else if (varianceCents > MAX_AUTO_VARIANCE_CENTS) {
      urgent = true;
      recoveryNote =
        `NOT charged automatically: ${formatCents(varianceCents)} is above the ` +
        `${formatCents(MAX_AUTO_VARIANCE_CENTS)} automatic cap. Decide manually; ` +
        `the seller's payout has not been touched.`;
    } else {
      const reason =
        `Courier re-weigh: you quoted the parcel at ${formatCents(quotedCents)}` +
        (body.charged_weight_kg != null
          ? ` (billed weight ${String(body.charged_weight_kg)} kg)`
          : '') +
        ` and the courier billed ${formatCents(chargedCents)}. The ` +
        `${formatCents(varianceCents)} difference is charged to you and deducted ` +
        `from your payout.`;
      const chargeRow = await raiseSellerCharge(this.prisma, {
        sellerId: tx.sellerId,
        transactionId: tx.id,
        kind: 'SHIPPING_VARIANCE',
        reason,
        amountCentsOverride: varianceCents,
        // Not a refund slice: the sale stands. These two only feed the
        // failure-fee calculation, which the override replaces.
        refundedTotalCents: tx.refundedAmount ?? 0,
        shipmentCommitted: true,
        shippingCost: quotedCents,
      }).catch((err: Error) => {
        this.logger.error(
          `could not raise the courier variance charge for ${tx.id}: ${err.message}`,
        );
        return null;
      });
      if (chargeRow) {
        void this.zoho
          .createShippingVarianceInvoice(chargeRow.id)
          .catch(() => undefined);
        recoveryNote = `Recovered from the seller's payout as SellerCharge ${chargeRow.id} (${formatCents(
          chargeRow.amountCents,
        )}); invoice raised to them with the reason.`;
      } else {
        urgent = true;
        recoveryNote =
          'Could not raise the seller charge automatically — investigate and raise it by hand.';
      }
    }

    // The surcharge is a COST we paid. The freight journal built from the quote
    // cannot carry it, so it is journalled here — otherwise Books shows the
    // recovery as income with no matching expense, and the carrier's statement
    // never reconciles. Independent of whether the seller was charged (above
    // the cap the cost is still ours).
    if (varianceCents > 0) {
      void this.zoho
        .createShippingVarianceJournal(tx.id)
        .catch(() => undefined);
    }

    const context =
      `Bob Go ${topic} for shipment ${shipmentId} (tx ${tx.id}): the carrier billed ` +
      `${formatCents(chargedCents)} where the buyer was charged ${formatCents(quotedCents)} — ` +
      `${sign} than quoted by ${formatCents(Math.abs(varianceCents))}. ` +
      `${recoveryNote} ` +
      `Raw charged_amount=${JSON.stringify(body.charged_amount)}.`;

    // One alert per sale, kept current. A re-weigh can deliver more than one
    // event, and an operator staring at three rows in a queue reads the oldest.
    const existing = await this.prisma.adminAlert
      .findFirst({
        where: {
          type: 'SHIPPING_CHARGE_VARIANCE',
          referenceId: tx.id,
          resolved: false,
        },
        select: { id: true },
      })
      .catch(() => null);
    if (existing) {
      await this.prisma.adminAlert
        .update({
          where: { id: existing.id },
          data: {
            context,
            urgent,
            // An automatic recovery needs no queue attention.
            resolved: !urgent,
            resolvedAt: urgent ? null : new Date(),
          },
        })
        .catch(() => undefined);
    } else if (urgent) {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'SHIPPING_CHARGE_VARIANCE',
            referenceId: tx.id,
            urgent: true,
            context,
          },
        })
        .catch(() => undefined);
    }
    this.logger.warn(context);
    return { handled: true };
  }

  private async onHealth(
    body: Record<string, unknown>,
  ): Promise<{ handled: boolean }> {
    const shipmentId = this.shipmentIdOf(body);
    const health = String(body.health_status ?? '').trim();
    this.record('shipment_health_status/updated', body, shipmentId);
    if (health && health !== 'healthy') {
      this.logger.warn(
        `Bob Go flagged shipment ${shipmentId ?? '?'} as "${health}"`,
      );
    }
    return { handled: true };
  }

  /** Bob Go has used several spellings for the id across payloads; try each. */
  private shipmentIdOf(body: Record<string, unknown>): string | null {
    for (const k of ['id', 'shipment_id', 'shipmentId']) {
      const v = body[k];
      if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) {
        return String(v);
      }
    }
    return null;
  }

  /**
   * Keep the raw payload.
   *
   * Best-effort and never awaited into the response path: losing an audit row
   * must not cause a non-2xx and a Bob Go retry. Stored whole because the whole
   * point is to see fields we did not know to ask for.
   */
  private record(
    topic: string,
    body: Record<string, unknown>,
    shipmentId?: string | null,
  ): void {
    void this.prisma.bobGoWebhookEvent
      ?.create({
        data: {
          topic,
          shipmentId: shipmentId ?? null,
          payload: body as never,
        },
      })
      .catch((e: Error) =>
        this.logger.warn(`Bob Go webhook not recorded: ${e.message}`),
      );
  }
}

/**
 * Bob Go's rand figure → our cents, or null when the payload does not carry a
 * recognisable amount.
 *
 * ⚠️ THE SHAPE IS NOT PINNED BY A DOCUMENT. `charged_amount` has been seen as a
 * bare number in the sandbox payloads; the other money fields in this API arrive
 * as `{ amount, currency }`-shaped objects on some endpoints, so every plausible
 * spelling is read and anything unrecognised returns null. The caller then
 * records the payload and stops rather than inventing a variance from a value it
 * did not understand.
 */
function randToCentsOrNull(raw: unknown): number | null {
  let value: unknown = raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    value = o.amount ?? o.value ?? o.total ?? o.total_price ?? o.price;
  }
  const n =
    typeof value === 'string'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** R1 234,56 — the desk reads sums of money, not integer cents. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const rand = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const rest = (abs % 100).toString().padStart(2, '0');
  return `${sign}R${rand},${rest}`;
}
