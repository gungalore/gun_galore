// Verifies the ShipLogic webhook handler against the REAL payload shape
// (hyphenated status slugs, no `event` field, tracking ref under
// short_/custom_tracking_reference). Mock the heavy collaborators so
// importing ShippingService doesn't drag in the NotificationsService /
// meilisearch import chains.
//
// These payloads were captured from The Courier Guy's official docs, and this
// file used to test processPudoEvent. That integration was retired (operator
// 2026-09-04) — but the handler under test, processShiplogicWebhook, is
// SHARED and still very much live for Pudo, which runs on the same ShipLogic
// platform and emits the identical shape. So the cases were RETARGETED at
// processPudoEvent rather than deleted with the vendor: they cover code that
// still runs on every real Pudo tracking update, including the two named
// regressions below. Deleting them with the integration would have quietly
// dropped live coverage.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class {},
}));
jest.mock('./pudo.service', () => ({ PudoService: class {} }));

import { ShippingService } from './shipping.service';

// A ShipLogic "Tracking event" webhook body, trimmed to the fields our handler
// reads, taken verbatim from the ShipLogic API docs sample.
function trackingEvent(status: string, over: Record<string, unknown> = {}) {
  return {
    custom_tracking_reference: 'SLXS7GL',
    short_tracking_reference: 'S7GL',
    parcel_tracking_references: ['SLXS7GL/1'],
    shipment_id: 108639,
    status,
    update_type: 'shipment',
    tracking_events: [{ id: 1, status, message: '' }],
    ...over,
  };
}

const TX = {
  id: 'tx1',
  listing: { id: 'l1', title: 'Rifle scope' },
  buyer: { email: 'buyer@x.co', firstName: 'Bo', phone: '0830000000' },
  seller: { email: 'sell@x.co', firstName: 'Sam' },
};

function makeService(currentStatus: string | null) {
  const notifications = {
    shippingDispatched: jest.fn(),
    shippingOutForDelivery: jest.fn(),
    shippingDelivered: jest.fn(),
    shippingFailed: jest.fn(),
    sellerParcelCollected: jest.fn(),
    sellerParcelDelivered: jest.fn(),
  };
  const txClient = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tx1',
        shippingStatus: currentStatus,
        dispatchedAt: currentStatus ? new Date() : null,
        deliveredAt: null,
        swapId: null,
        listing: { title: 'Rifle scope' },
        buyer: { email: 'buyer@x.co', firstName: 'Bo' },
        seller: {
          email: 'sell@x.co',
          firstName: 'Sam',
          lastName: 'Seller',
          username: 'sam',
          phone: '0830000000',
        },
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // DELIVERY_FAILED / RETURNED raise an AdminAlert atomically in the same
    // DB transaction as the status write.
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    // findTransactionByTrackingNumber matches on the stored short ref.
    transaction: {
      findFirst: jest.fn(({ where }: { where: { trackingReference: string } }) =>
        Promise.resolve(where.trackingReference === 'S7GL' ? { ...TX } : null),
      ),
    },
    $transaction: (cb: (tx: unknown) => unknown) => cb(txClient),
  };
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    {} as never,
    {} as never,
    // Webhook ingestion never reads a flag; a stub keeps the constructor happy.
    { get: jest.fn().mockResolvedValue(false) } as never,
  );
  return { svc, notifications, prisma, txClient };
}

describe('ShippingService.processPudoEvent (real ShipLogic payload)', () => {
  it('maps hyphenated "at-hub" → IN_TRANSIT, finds the tx by short ref, notifies the buyer', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processPudoEvent(trackingEvent('at-hub'));
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trackingReference: 'S7GL' } }),
    );
    expect(notifications.shippingDispatched).toHaveBeenCalledTimes(1);
  });

  it('"delivered" → DELIVERED notifies buyer + seller', async () => {
    const { svc, notifications } = makeService('OUT_FOR_DELIVERY');
    await svc.processPudoEvent(trackingEvent('delivered'));
    expect(notifications.shippingDelivered).toHaveBeenCalledTimes(1);
    expect(notifications.sellerParcelDelivered).toHaveBeenCalledTimes(1);
  });

  it('"out-for-delivery" → OUT_FOR_DELIVERY (buyer email only, no seller)', async () => {
    const { svc, notifications } = makeService('IN_TRANSIT');
    await svc.processPudoEvent(trackingEvent('out-for-delivery'));
    expect(notifications.shippingOutForDelivery).toHaveBeenCalledTimes(1);
    expect(notifications.sellerParcelCollected).not.toHaveBeenCalled();
  });

  it('does NOT re-notify the buyer once already past COLLECTED (hub scans are quiet)', async () => {
    // current already COLLECTED → an at-hub/in-transit scan must not re-fire.
    const { svc, notifications } = makeService('COLLECTED');
    await svc.processPudoEvent(trackingEvent('in-transit'));
    expect(notifications.shippingDispatched).not.toHaveBeenCalled();
  });

  it('ignores intermediate/internal statuses (collection-assigned) — no lookup, no notify', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processPudoEvent(trackingEvent('collection-assigned'));
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(notifications.shippingDispatched).not.toHaveBeenCalled();
  });

  it('ignores a note payload (no status field at all)', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processPudoEvent({
      message: 'sender note',
      shipment_short_tracking_reference: 'S7GL',
      type: 'external',
    });
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(notifications.shippingDispatched).not.toHaveBeenCalled();
  });

  it('falls back to custom_tracking_reference when short is absent', async () => {
    const { svc, prisma } = makeService(null);
    (prisma.transaction.findFirst as jest.Mock).mockImplementation(
      ({ where }: { where: { trackingReference: string } }) =>
        Promise.resolve(where.trackingReference === 'SLXS7GL' ? { ...TX } : null),
    );
    await svc.processPudoEvent(
      trackingEvent('delivered', { short_tracking_reference: undefined }),
    );
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trackingReference: 'SLXS7GL' } }),
    );
  });

  // ── SAFETY REGRESSIONS ──────────────────────────────────────────────
  // The old substring map sent BOTH of these to DELIVERED (they contain
  // "deliver"), which would falsely confirm receipt + start the payout
  // countdown. They must NEVER map to DELIVERED.
  it('out-for-delivery does NOT map to DELIVERED (regression)', async () => {
    const { svc, notifications } = makeService('IN_TRANSIT');
    await svc.processPudoEvent(trackingEvent('out-for-delivery'));
    expect(notifications.shippingDelivered).not.toHaveBeenCalled();
    expect(notifications.shippingOutForDelivery).toHaveBeenCalledTimes(1);
  });

  it('delivery-failed-attempt → DELIVERY_FAILED, never DELIVERED (regression)', async () => {
    const { svc, notifications, txClient } = makeService('OUT_FOR_DELIVERY');
    await svc.processPudoEvent(trackingEvent('delivery-failed-attempt'));
    expect(notifications.shippingDelivered).not.toHaveBeenCalled();
    expect(notifications.shippingFailed).toHaveBeenCalledTimes(1);
    // Money-critical: a failed delivery must surface on the admin queue —
    // deliveredAt never gets set so no sweep would ever find this order.
    expect(txClient.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SHIPMENT_DELIVERY_FAILED' }),
      }),
    );
  });
});

describe('ShippingService.processPudoEvent (delegation)', () => {
  it('delegates to the shared handler — "collected-by-recipient" → DELIVERED', async () => {
    const { svc, notifications, prisma } = makeService('OUT_FOR_DELIVERY');
    // Pudo stores custom_tracking_reference at booking.
    (prisma.transaction.findFirst as jest.Mock).mockImplementation(
      ({ where }: { where: { trackingReference: string } }) =>
        Promise.resolve(where.trackingReference === 'PUDOD000570' ? { ...TX } : null),
    );
    await svc.processPudoEvent({
      custom_tracking_reference: 'PUDOD000570',
      status: 'collected-by-recipient',
    });
    expect(notifications.shippingDelivered).toHaveBeenCalledTimes(1);
    expect(notifications.sellerParcelDelivered).toHaveBeenCalledTimes(1);
  });

  it('is formatting-robust: "IN_TRANSIT" (underscored/upper) → IN_TRANSIT', async () => {
    const { svc, notifications } = makeService(null);
    await svc.processPudoEvent({ short_tracking_reference: 'S7GL', status: 'IN_TRANSIT' });
    expect(notifications.shippingDispatched).toHaveBeenCalledTimes(1);
  });
});
