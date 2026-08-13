import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PudoService, type RawTrackingEvent } from './pudo.service';
import { ShippingService } from './shipping.service';
import {
  mapPudoStatus,
  toShippingStatus,
  STATUS_LABEL,
} from './status-map';

// Sources we attribute timeline rows to. Free strings on the column so
// we don't need a Prisma migration to add a new courier later, but the
// values written from the codebase should come from this union.
export type TrackingSource = 'INTERNAL' | 'PUDO' | 'TCG';

// Collapsed internal status values that mark a parcel as "no longer
// changing" — the polling cron skips transactions whose latest event
// is in this set. Saves an HTTP round trip per stale row every 10 min.
const TERMINAL_STATUSES = new Set<string>([
  'COLLECTED_BY_BUYER',
  'DELIVERED',
  'RETURN_INITIATED',
  'DELIVERY_FAILED',
  'UNDELIVERABLE',
  'PIN_EXPIRED',
  'CANCELLED',
  'PAYOUT_RELEASED',
]);

// Collapsed statuses that mean the buyer has the parcel — used to
// auto-capture a proof-of-delivery reference (Phase 5 P5.3).
const DELIVERY_DONE_STATUSES = new Set<string>([
  'DELIVERED',
  'COLLECTED_BY_BUYER',
]);

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pudo: PudoService,
    private readonly shipping: ShippingService,
  ) {}

  // ------------------------------------------------------------------
  // Record an INTERNAL milestone. Called from TransactionsService at
  // each lifecycle hook. Idempotent — the @@unique(transactionId,
  // status, occurredAt) tuple stops duplicate inserts if the same hook
  // fires twice (e.g. webhook + verifyResult both landing). When the
  // collapsed status maps to a Prisma ShippingStatus enum value, the
  // Transaction.shippingStatus column is rolled forward in lockstep
  // via the existing applyShippingUpdate() helper (handles back-step
  // rejection + buyer notification side-effects).
  // ------------------------------------------------------------------
  async recordInternal(
    transactionId: string,
    status: string,
    opts: { message?: string; occurredAt?: Date } = {},
  ): Promise<void> {
    const occurredAt = opts.occurredAt ?? new Date();
    try {
      await this.prisma.trackingEvent.create({
        data: {
          transactionId,
          status,
          rawStatus: null,
          source: 'INTERNAL',
          message: opts.message ?? STATUS_LABEL[status] ?? null,
          occurredAt,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation = same event already logged.
      // Anything else gets surfaced via the warn log; we don't throw
      // because tracking is non-critical to the parent business action.
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') {
        this.logger.warn(
          `recordInternal(${transactionId}, ${status}) failed: ${(err as Error).message}`,
        );
      }
    }

    // Mirror to Transaction.shippingStatus when applicable.
    const collapsedToPrisma = toShippingStatus(status);
    if (collapsedToPrisma) {
      await this.shipping
        .applyShippingUpdate(transactionId, collapsedToPrisma)
        .catch((err) =>
          this.logger.warn(
            `applyShippingUpdate(${transactionId}, ${collapsedToPrisma}) failed: ${(err as Error).message}`,
          ),
        );
    }
  }

  // ------------------------------------------------------------------
  // Poll Pudo for fresh tracking events on every active Pudo shipment.
  // Called by the tasks cron every 10 minutes. Active = trackingReference
  // is set AND the last logged event is not in TERMINAL_STATUSES.
  // ------------------------------------------------------------------
  async pollPudoShipments(): Promise<{ scanned: number; ingested: number }> {
    // Candidate transactions — Pudo only, with a tracking reference,
    // not in a terminal Prisma status. We further filter by terminal
    // collapsed status after fetching the latest event below.
    const candidates = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'PUDO',
        // EXCLUDE parcels that are actually with Bob Go.
        //
        // Since Bob Go sits behind the enum slots, a Bob Go pickup-point order
        // has shippingMethod PUDO — but its waybill means nothing to Pudo's
        // API, which would answer 404 for ever. fetchTrackingEvents returns
        // null on 404 and the loop just `continue`s, so there would be no
        // error, no alert and no log line: the rail would simply go blind
        // while every downstream state (dispatchedAt, deliveredAt, the buyer's
        // timeline) silently stopped advancing.
        //
        // Null carrierProvider means a row booked before that column existed,
        // which can only be genuine Pudo — so those must stay in.
        OR: [{ carrierProvider: null }, { carrierProvider: { not: 'BOBGO' } }],
        trackingReference: { not: null },
        shippingStatus: {
          notIn: ['DELIVERED', 'DELIVERY_FAILED', 'RETURNED'],
        },
      },
      select: {
        id: true,
        trackingReference: true,
      },
    });

    let ingested = 0;
    for (const tx of candidates) {
      if (!tx.trackingReference) continue;

      // Cheap terminal-state check on the latest logged event — saves
      // an HTTP call when a row is already done from our side.
      const latest = await this.prisma.trackingEvent.findFirst({
        where: { transactionId: tx.id },
        orderBy: { occurredAt: 'desc' },
        select: { status: true },
      });
      if (latest && TERMINAL_STATUSES.has(latest.status)) continue;

      const events = await this.pudo.fetchTrackingEvents(tx.trackingReference);
      if (!events) continue; // 404 / network — try again next tick

      ingested += await this.ingestPudoEvents(tx.id, events);
    }

    return { scanned: candidates.length, ingested };
  }

  // ------------------------------------------------------------------
  // Take an array of raw Pudo tracking events, map → internal status,
  // and append the ones we haven't already logged. Idempotency comes
  // from the @@unique(transactionId, status, occurredAt) DB constraint
  // — duplicate inserts surface as P2002 and we swallow them.
  // ------------------------------------------------------------------
  private async ingestPudoEvents(
    transactionId: string,
    events: RawTrackingEvent[],
  ): Promise<number> {
    let inserted = 0;

    // Sort oldest → newest so the Prisma shipping-status rollup sees
    // events in the right order (applyShippingUpdate refuses backward
    // transitions).
    const sorted = [...events].sort((a, b) => {
      const ta = a.event_time ? Date.parse(a.event_time) : 0;
      const tb = b.event_time ? Date.parse(b.event_time) : 0;
      return ta - tb;
    });

    for (const raw of sorted) {
      const collapsed = mapPudoStatus(raw.status);
      const occurredAt = raw.event_time
        ? new Date(raw.event_time)
        : new Date();
      if (Number.isNaN(occurredAt.getTime())) continue;

      try {
        await this.prisma.trackingEvent.create({
          data: {
            transactionId,
            status: collapsed,
            rawStatus: raw.status,
            source: 'PUDO',
            message:
              raw.description ??
              STATUS_LABEL[collapsed] ??
              null,
            occurredAt,
          },
        });
        inserted++;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'P2002') {
          this.logger.warn(
            `ingestPudoEvents row failed (${transactionId}/${collapsed}): ${(err as Error).message}`,
          );
        }
        // P2002 = duplicate, expected on re-polls — skip silently.
        continue;
      }

      const prismaStatus = toShippingStatus(collapsed);
      if (prismaStatus) {
        await this.shipping
          .applyShippingUpdate(transactionId, prismaStatus)
          .catch((err) =>
            this.logger.warn(
              `applyShippingUpdate(${transactionId}, ${prismaStatus}) failed: ${(err as Error).message}`,
            ),
          );
      }

      // Proof-of-delivery auto-capture (Phase 5 P5.3). On the carrier's
      // delivery/collection event, stamp a human-readable POD reference
      // from the event (locker/terminal + time) — carriers expose no
      // signature/photo, so this is the best automatic artefact. Set once
      // (guard on podReference: null) so re-polls don't overwrite it.
      if (DELIVERY_DONE_STATUSES.has(collapsed)) {
        const podReference = [
          'PUDO',
          raw.terminal_name ?? raw.location ?? 'locker',
          raw.terminal_id ? `(${raw.terminal_id})` : null,
          raw.event_time ? `@ ${raw.event_time}` : null,
        ]
          .filter(Boolean)
          .join(' ');
        await this.prisma.transaction
          .updateMany({
            where: { id: transactionId, podReference: null },
            data: { podReference },
          })
          .catch(() => undefined);
      }
    }

    return inserted;
  }

  // ------------------------------------------------------------------
  // Buyer/seller-facing timeline for /transactions/[id]. Authorises
  // against the same buyer-or-seller rule the rest of the transaction
  // endpoints use. Returns events oldest → newest.
  // ------------------------------------------------------------------
  async getTimeline(transactionId: string, clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new NotFoundException('User not found');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        shippingMethod: true,
        shippingStatus: true,
        trackingReference: true,
        paidAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        releasedAt: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== user.id && tx.sellerId !== user.id) {
      throw new ForbiddenException('Not authorised');
    }

    const events = await this.prisma.trackingEvent.findMany({
      where: { transactionId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        status: true,
        rawStatus: true,
        source: true,
        message: true,
        occurredAt: true,
        recordedAt: true,
      },
    });

    return {
      transactionId: tx.id,
      shippingMethod: tx.shippingMethod,
      shippingStatus: tx.shippingStatus,
      trackingReference: tx.trackingReference,
      milestones: {
        paidAt: tx.paidAt,
        dispatchedAt: tx.dispatchedAt,
        deliveredAt: tx.deliveredAt,
        releasedAt: tx.releasedAt,
      },
      events: events.map((e) => ({
        ...e,
        label: STATUS_LABEL[e.status] ?? e.message ?? e.status,
      })),
    };
  }
}
