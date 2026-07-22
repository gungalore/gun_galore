// Verifies the TCG/Shiplogic webhook handler against the REAL payload shape
// from The Courier Guy's official docs (hyphenated status slugs, no `event`
// field, tracking ref under short_/custom_tracking_reference). Mock the heavy
// collaborators so importing ShippingService doesn't drag in the
// NotificationsService / meilisearch import chains.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class {},
}));
jest.mock('./pudo.service', () => ({ PudoService: class {} }));
jest.mock('./tcg.service', () => ({ TcgService: class {} }));

import { ShippingService } from './shipping.service';

// A TCG "Tracking event" webhook body, trimmed to the fields our handler
// reads, taken verbatim from the Courier Guy API docs sample.
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
  );
  return { svc, notifications, prisma, txClient };
}

describe('ShippingService.processTcgEvent (real TCG payload)', () => {
  it('maps hyphenated "at-hub" → IN_TRANSIT, finds the tx by short ref, notifies the buyer', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processTcgEvent(trackingEvent('at-hub'));
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trackingReference: 'S7GL' } }),
    );
    expect(notifications.shippingDispatched).toHaveBeenCalledTimes(1);
  });

  it('"delivered" → DELIVERED notifies buyer + seller', async () => {
    const { svc, notifications } = makeService('OUT_FOR_DELIVERY');
    await svc.processTcgEvent(trackingEvent('delivered'));
    expect(notifications.shippingDelivered).toHaveBeenCalledTimes(1);
    expect(notifications.sellerParcelDelivered).toHaveBeenCalledTimes(1);
  });

  it('"out-for-delivery" → OUT_FOR_DELIVERY (buyer email only, no seller)', async () => {
    const { svc, notifications } = makeService('IN_TRANSIT');
    await svc.processTcgEvent(trackingEvent('out-for-delivery'));
    expect(notifications.shippingOutForDelivery).toHaveBeenCalledTimes(1);
    expect(notifications.sellerParcelCollected).not.toHaveBeenCalled();
  });

  it('does NOT re-notify the buyer once already past COLLECTED (hub scans are quiet)', async () => {
    // current already COLLECTED → an at-hub/in-transit scan must not re-fire.
    const { svc, notifications } = makeService('COLLECTED');
    await svc.processTcgEvent(trackingEvent('in-transit'));
    expect(notifications.shippingDispatched).not.toHaveBeenCalled();
  });

  it('ignores intermediate/internal statuses (collection-assigned) — no lookup, no notify', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processTcgEvent(trackingEvent('collection-assigned'));
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(notifications.shippingDispatched).not.toHaveBeenCalled();
  });

  it('ignores a note payload (no status field at all)', async () => {
    const { svc, notifications, prisma } = makeService(null);
    await svc.processTcgEvent({
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
    await svc.processTcgEvent(
      trackingEvent('delivered', { short_tracking_reference: undefined }),
    );
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trackingReference: 'SLXS7GL' } }),
    );
  });
});
