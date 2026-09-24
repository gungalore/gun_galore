jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// What the seller is TOLD TO DO when a shipment is booked.
//
// This is the single most consequential piece of copy in the shipping rail: it
// goes out as a `critical: true` SMS that bypasses the seller's SMS mute, so it
// is the one message guaranteed to reach their phone. If it describes the wrong
// hand-over, they act on it.
//
// Bob Go is the only courier rail and it always collects from the seller's
// address — verified against a real shipment, which carried
// collection_location_type "door" and an 08:00-17:00 window even when
// delivering to a Bob Box. Lockers were retired with Pudo, so the copy must
// never tell a seller to go to one: they would make a wasted trip and miss the
// courier.

function makeService() {
  const sent: {
    sms: string[];
    emails: string[];
    inbox: string[];
    whatsapp: (string | null)[];
    critical: (boolean | undefined)[];
  } = {
    sms: [],
    emails: [],
    inbox: [],
    whatsapp: [],
    critical: [],
  };
  const svc = Object.create(NotificationsService.prototype) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    persistByEmail: jest.fn(async (_e: string, n: { body: string }) => {
      sent.inbox.push(n.body);
    }),
    send: jest.fn(async (_to: string, _subj: string, html: string) => {
      sent.emails.push(html);
    }),
    sendSms: jest.fn(
      async (
        _to: unknown,
        body: string,
        _ref?: unknown,
        opts?: { critical?: boolean; whatsapp?: { templateKey?: string } },
      ) => {
        sent.sms.push(body);
        sent.critical.push(opts?.critical);
        sent.whatsapp.push(opts?.whatsapp?.templateKey ?? null);
      },
    ),
    email: (a: { body: string; rows?: { label: string; value: string }[] }) =>
      a.body + '||ROWS||' + JSON.stringify(a.rows ?? []),
  });
  return { svc, sent };
}

const BASE = {
  sellerEmail: 's@x.co',
  sellerName: 'Jan',
  sellerPhone: '0820000000',
  listingTitle: 'Camping lantern',
  transactionId: 'TX1',
  trackingReference: 'UASS9DLM',
};

describe('shipmentBooked copy', () => {
  it('tells the seller a courier collects from their address, NOT to visit a locker', async () => {
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE });

    const all = [...sent.sms, ...sent.emails].join(' ');
    expect(all).not.toMatch(/locker/i);
    expect(all).not.toMatch(/Pudo/i);
    expect(all).not.toMatch(/drop[- ]?off/i);
    expect(sent.sms[0]).toMatch(/collects from your address/i);
  });

  it('gives the collection window, since the seller has to be there', async () => {
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE });
    expect(sent.sms[0]).toContain('08:00-17:00');
    expect(sent.emails[0]).toMatch(/between 08:00 and 17:00/);
  });

  it('names Bob Go, not The Courier Guy', async () => {
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE });
    expect(sent.emails[0]).toContain('Bob Go');
    expect(sent.emails[0]).not.toContain('The Courier Guy');
  });

  it('labels a PIN as a collection PIN, never a locker drop-off PIN', async () => {
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE, dropoffPin: '4821' });
    expect(sent.emails[0]).toContain('Collection PIN');
    expect(sent.emails[0]).not.toMatch(/locker screen/i);
    expect(sent.emails[0]).not.toMatch(/drop-off PIN/i);
  });

  it('says nothing about a PIN when none was issued', async () => {
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE });
    expect([...sent.sms, ...sent.emails].join(' ')).not.toMatch(/PIN/);
  });

  it('sends the critical SMS and the door WhatsApp template, even with a PIN', async () => {
    // The SMS bypasses the seller's mute; the WhatsApp rail has to use the
    // door template or it would send the seller to a locker screen that has
    // nothing to do with the courier coming to their address.
    const { svc, sent } = makeService();
    await svc.shipmentBooked({ ...BASE, dropoffPin: '4821' });
    expect(sent.critical[0]).toBe(true);
    expect(sent.whatsapp[0]).toBe('shipment_booked_seller_door');
  });
});
