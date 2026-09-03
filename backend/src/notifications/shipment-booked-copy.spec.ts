jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// What the seller is TOLD TO DO when a shipment is booked.
//
// This is the single most consequential piece of copy in the shipping rail: it
// goes out as a `critical: true` SMS that bypasses the seller's SMS mute, so it
// is the one message guaranteed to reach their phone. If it describes the wrong
// hand-over, they act on it.
//
// The trap is that the SLOT no longer implies the seller's job. On the legacy
// rail PUDO meant "walk it to a locker" and TCG meant "a courier comes". Bob Go
// collects from an address either way — verified against a real shipment, which
// carried collection_location_type "door" and an 08:00-17:00 window even when
// delivering to a Bob Box. So a Bob Go "PUDO" sale must never tell a seller to
// go to a locker: they would make a wasted trip and miss the courier.

function makeService() {
  const sent: { sms: string[]; emails: string[]; inbox: string[] } = {
    sms: [],
    emails: [],
    inbox: [],
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
    sendSms: jest.fn(async (_to: unknown, body: string) => {
      sent.sms.push(body);
    }),
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
  describe('on the Bob Go rail', () => {
    it('tells a PICKUP-POINT seller a courier is coming, NOT to visit a locker', async () => {
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'PUDO', provider: 'BOBGO' });

      const all = [...sent.sms, ...sent.emails].join(' ');
      expect(all).not.toMatch(/drop/i);
      expect(all).not.toMatch(/Pudo/i);
      expect(sent.sms[0]).toMatch(/collects from your address/i);
    });

    it('gives the collection window, since the seller has to be there', async () => {
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'TCG', provider: 'BOBGO' });
      expect(sent.sms[0]).toContain('08:00-17:00');
      expect(sent.emails[0]).toMatch(/between 08:00 and 17:00/);
    });

    it('names Bob Go, not The Courier Guy', async () => {
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'TCG', provider: 'BOBGO' });
      expect(sent.emails[0]).toContain('Bob Go');
      expect(sent.emails[0]).not.toContain('The Courier Guy');
    });

    it('does not call a PIN a locker drop-off PIN', async () => {
      // Whether Bob Go issues one at all is unproven; if it does, it is not
      // used at a locker screen the seller is never going to.
      const { svc, sent } = makeService();
      await svc.shipmentBooked({
        ...BASE,
        carrier: 'PUDO',
        provider: 'BOBGO',
        dropoffPin: '4821',
      });
      expect(sent.emails[0]).toContain('Collection PIN');
      expect(sent.emails[0]).not.toMatch(/locker screen/i);
    });

    it('says nothing about a PIN when none was issued', async () => {
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'PUDO', provider: 'BOBGO' });
      expect([...sent.sms, ...sent.emails].join(' ')).not.toMatch(/PIN/);
    });
  });

  describe('on the legacy rail, unchanged', () => {
    it('still tells a Pudo seller to drop at a locker, with the PIN', async () => {
      const { svc, sent } = makeService();
      await svc.shipmentBooked({
        ...BASE,
        carrier: 'PUDO',
        dropoffPin: '270089',
      });
      expect(sent.sms[0]).toMatch(/Drop at any Pudo locker/);
      expect(sent.sms[0]).toContain('270089');
      expect(sent.emails[0]).toMatch(/locker screen/);
    });

    it('tells a door seller a courier will collect, WITHOUT naming one', async () => {
      // This used to assert the copy said "Courier Guy will collect". That
      // integration was retired (operator 2026-09-04) and Bob Go serves the
      // DOOR slot now, so naming a company here would print a guess as a fact
      // — and would name the one courier we are certain is NOT coming.
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'TCG' });
      expect(sent.sms[0]).toMatch(/courier will collect/i);
      expect(sent.sms[0]).not.toMatch(/Courier Guy/);
    });

    it('treats a missing provider as legacy', async () => {
      // Rows booked before carrierProvider existed can only be Pudo or TCG.
      const { svc, sent } = makeService();
      await svc.shipmentBooked({ ...BASE, carrier: 'PUDO', provider: null });
      expect(sent.sms[0]).toMatch(/Drop at any Pudo locker/);
    });
  });
});
