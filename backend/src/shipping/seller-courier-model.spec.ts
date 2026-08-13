jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// What the SELL FORM asks a seller about couriering.
//
// Served from the backend so the sell form never needs to read a feature flag.
// The distinction it encodes is real: on the legacy rail the seller's pick
// describes THEIR OWN hand-over — PUDO means walking the parcel to a locker and
// needing no pickup address at all, TCG means a courier comes to them. Under
// Bob Go a courier collects from their address either way and the buyer chooses
// how they receive it, so there is only one thing to opt into.

function makeService(bobgoOn: boolean) {
  return new ShippingService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue(bobgoOn) } as never,
  );
}

describe('sellerCourierModel', () => {
  it('keeps the seller choosing on the legacy rail', async () => {
    const m = await makeService(false).sellerCourierModel();
    expect(m.sellerPicksOption).toBe(true);
  });

  it('stops asking once Bob Go carries both shapes', async () => {
    const m = await makeService(true).sellerCourierModel();
    expect(m.sellerPicksOption).toBe(false);
  });

  it('always names both slots to store, so opting in offers the buyer everything', async () => {
    // Ticking one "courier delivery" box must store BOTH, or the buyer-decides
    // rule would have nothing to offer from.
    for (const on of [true, false]) {
      const m = await makeService(on).sellerCourierModel();
      expect(m.courierMethods).toEqual(['PUDO', 'TCG']);
    }
  });

  it('tells the seller a courier comes to them, and when', async () => {
    // The seller has to be there. Under Bob Go they never walk to a locker.
    const m = await makeService(true).sellerCourierModel();
    expect(m.hint).toMatch(/collects from your address/i);
    expect(m.hint).toContain('08:00');
    expect(m.hint).toContain('17:00');
    expect(m.hint).not.toMatch(/locker/i);
  });
});
