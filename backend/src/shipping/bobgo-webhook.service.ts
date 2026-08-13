import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { bobgoToShippingStatus } from './status-map';
import { ShippingService } from './shipping.service';

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
 * our own bug would be worse than a dropped event we can recover by polling —
 * the poll still runs and remains the backstop.
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
   * stamping shipmentBookedAt AND sending the seller a `critical: true` SMS
   * that bypasses their mute — that belongs in exactly one place, and it is
   * already written and tested in ShippingService. All this does is make the
   * row eligible so the very next sweep finishes it. A webhook that races the
   * sweep to send the same SMS twice is a worse outcome than a short wait.
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
