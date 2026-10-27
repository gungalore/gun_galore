jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// Shipping comms belong to Bob Go.
//
// Bob Go emails the seller the waybill PDF at booking and sends every tracking
// update to both parties (email, plus WhatsApp with SMS fallback for buyers).
// AllOutdoor must only write the in-app row so its own WhatsApp/email/SMS
// rails never duplicate — and never pay for — a message Bob Go already sends.

function makeService() {
  const inbox: { email: string; n: Record<string, unknown> }[] = [];
  const external = { emails: [] as string[], sms: [] as string[] };
  const svc = Object.create(
    NotificationsService.prototype,
  ) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    persistByEmail: jest.fn(
      async (email: string, n: Record<string, unknown>) => {
        inbox.push({ email, n });
      },
    ),
    email: jest.fn(() => 'html'),
    send: jest.fn(async (_to: string, subject: string) => {
      external.emails.push(subject);
    }),
    sendSms: jest.fn(async (_to: unknown, body: string) => {
      external.sms.push(body);
    }),
  });
  return { svc, inbox, external };
}

const BASE = {
  sellerEmail: 's@x.co',
  sellerName: 'Jan',
  sellerPhone: '0820000000',
  listingTitle: 'Camping lantern',
  transactionId: 'TX1',
};

function expectNoExternal(external: ReturnType<typeof makeService>['external']) {
  expect(external.emails).toEqual([]);
  expect(external.sms).toEqual([]);
}

describe('shipping notifications are inbox-only', () => {
  it('booked: keeps the waybill in the inbox and sends nothing externally', async () => {
    const { svc, inbox, external } = makeService();
    await svc.shipmentBooked({
      ...BASE,
      trackingReference: 'UASS9DLM',
      dropoffPin: '4821',
    });

    expect(inbox).toHaveLength(1);
    expect(inbox[0].email).toBe(BASE.sellerEmail);
    expect(inbox[0].n.title).toBe('Ship your sale');
    expect(inbox[0].n.body).toContain('UASS9DLM');
    expect(inbox[0].n.body).toContain('4821');
    expectNoExternal(external);
  });

  it('collected: keeps the seller inbox row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.sellerParcelCollected(BASE);

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.type).toBe('shipment_collected');
    expectNoExternal(external);
  });

  it('delivered (seller): keeps the seller inbox row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.sellerParcelDelivered(BASE);

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.type).toBe('shipment_delivered_seller');
    expectNoExternal(external);
  });

  it('dispatched (buyer): keeps the action-required row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.shippingDispatched(
      'b@x.co',
      'Buyer',
      BASE.listingTitle,
      BASE.transactionId,
    );

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.title).toBe('Dispatched');
    expectNoExternal(external);
  });

  it('ready for pickup (buyer): keeps the action-required row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.shippingReadyForPickup(
      'b@x.co',
      'Buyer',
      BASE.listingTitle,
      BASE.transactionId,
      '0830000000',
    );

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.title).toBe('Ready to collect');
    expectNoExternal(external);
  });

  it('delivered (buyer): keeps the confirm-receipt row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.shippingDelivered(
      'b@x.co',
      'Buyer',
      BASE.listingTitle,
      BASE.transactionId,
      '0830000000',
    );

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.title).toBe('Delivered — confirm receipt');
    expect(inbox[0].n.dismissible).toBe(false);
    expectNoExternal(external);
  });

  it('delivery failed (buyer): keeps the push row, no external send', async () => {
    const { svc, inbox, external } = makeService();
    await svc.shippingFailed(
      'b@x.co',
      'Buyer',
      BASE.listingTitle,
      BASE.transactionId,
    );

    expect(inbox).toHaveLength(1);
    expect(inbox[0].n.type).toBe('shipment_failed');
    expect(inbox[0].n.forcePush).toBe(true);
    expectNoExternal(external);
  });
});
