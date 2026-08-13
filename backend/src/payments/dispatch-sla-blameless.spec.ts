// DispatchSlaService pulls in ShippingService -> PudoService -> SearchService
// -> ESM-only meilisearch. The function under test is pure, but importing the
// module still loads the chain.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { blamelessSeller } from './dispatch-sla.service';

// Who gets a dispatch strike when a courier order is auto-refunded.
//
// Three strikes queues a seller for suspension review, so this is not a
// bookkeeping detail — it decides whether the platform's own carrier failures
// build a case against innocent people.

describe('blamelessSeller', () => {
  it('spares a seller whose Bob Go booking never completed', () => {
    // No waybill, no PIN, nothing handed over — they could not have dispatched.
    expect(
      blamelessSeller({ carrierProvider: 'BOBGO', shipmentBookedAt: null }),
    ).toBe(true);
  });

  it('still blames a seller who WAS given a booked Bob Go shipment', () => {
    expect(
      blamelessSeller({ carrierProvider: 'BOBGO', shipmentBookedAt: new Date() }),
    ).toBe(false);
  });

  it('leaves the legacy rails exactly as they were', () => {
    // Pudo and TCG are booked-or-throw, so an un-booked row there means the
    // booking failed loudly and the seller had the manual fallback all along.
    for (const p of ['PUDO', 'TCG', null]) {
      expect(blamelessSeller({ carrierProvider: p, shipmentBookedAt: null })).toBe(
        false,
      );
      expect(
        blamelessSeller({ carrierProvider: p, shipmentBookedAt: new Date() }),
      ).toBe(false);
    }
  });
});
