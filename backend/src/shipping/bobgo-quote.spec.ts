jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// Quoting with the Bob Go rail ON.
//
// The behaviour that matters here is what a buyer sees when things go wrong.
// Both legacy clients returned null for everything, so "no rate for this route"
// and "the carrier is down" were indistinguishable — the buyer got the same
// empty shipping list and the sale was lost silently. Bob Go's client throws on
// an outage, and these tests pin down that the distinction survives.

const LISTING = {
  id: 'L1',
  isFirearm: false,
  collectionOnly: false,
  isDealListing: false,
  weightGrams: 2500,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  price: 150000,
  shippingMethods: [],
  province: 'WESTERN_CAPE',
  pickupStreet: '1 Main Road',
  pickupSuburb: 'Durbanville',
  pickupCity: 'Cape Town',
  pickupPostalCode: '7550',
  pickupLat: -33.83,
  pickupLng: 18.65,
};

const DELIVERY = {
  streetAddress: '44 Stanley Avenue',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
  province: 'GAUTENG' as never,
  lat: -26.18,
  lng: 28.01,
};

const DOOR = {
  id: 3082,
  serviceCode: 'bobgo_3082_34_0',
  serviceName: 'Standard shipping',
  totalPrice: 114.95,
  baseRate: 114.95,
  currency: 'ZAR',
  type: 'door' as const,
  serviceLevelCode: 'ECO',
  providerSlug: 'sandbox',
  liabilityCoverPrice: 0,
  surchargeTotal: 0,
};

const PICKUP = {
  ...DOOR,
  id: 3084,
  serviceCode: 'bobgo_PP_3084_104_545_1',
  serviceName: 'Bob Box Locker – 44 on Stanley',
  totalPrice: 64.43,
  type: 'pickup-point' as const,
  serviceLevelCode: 'BOXM-M',
  providerSlug: 'demo',
  pickupPointLocationId: 545,
  pickupPointDistanceKm: 0.05,
};

function makeService(bobgoBehaviour: { rates?: unknown[]; throws?: Error } = {}) {
  const prisma = {
    listing: {
      findUnique: jest.fn().mockResolvedValue(LISTING),
      findMany: jest.fn().mockResolvedValue([LISTING]),
    },
  };
  // Typed as a bare jest.Mock so `.mock.calls[0][0]` is reachable — an
  // inferred zero-arg mock gives calls the tuple type [] and tsc rejects it.
  const getRates: jest.Mock = jest.fn(() =>
    bobgoBehaviour.throws
      ? Promise.reject(bobgoBehaviour.throws)
      : Promise.resolve({ rates: bobgoBehaviour.rates ?? [], pricingVerified: false }),
  );
  const bobgo = { getRates };
  const svc = new ShippingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    bobgo as never,
    { get: jest.fn().mockResolvedValue(true) } as never, // bobgo_enabled ON
  );
  return { svc, bobgo, prisma };
}

describe('quoteForListing on the Bob Go rail', () => {
  it('quotes the door slot from the door rate', async () => {
    const { svc } = makeService({ rates: [DOOR, PICKUP] });
    const q = await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'TCG',
      deliveryAddress: DELIVERY,
    });
    expect(q.priceCents).toBe(11495);
    expect(q.serviceCode).toBe('bobgo_3082_34_0');
    // Without these the booking days later cannot reconstruct the rate.
    expect(q.providerSlug).toBe('sandbox');
    expect(q.serviceLevelCode).toBe('ECO');
  });

  it('quotes the pickup-point slot from the same single call', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR, PICKUP] });
    const q = await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'PUDO',
      toLockerId: '545',
      deliveryAddress: DELIVERY,
    });
    expect(q.priceCents).toBe(6443);
    expect(q.pickupPointLocationId).toBe(545);
    // One call served both slots — that is the whole point of the aggregator.
    expect(bobgo.getRates).toHaveBeenCalledTimes(1);
  });

  it('sends the declared value in cents for the client to convert', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR] });
    await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'TCG',
      deliveryAddress: DELIVERY,
    });
    expect(bobgo.getRates.mock.calls[0][0].declaredValueCents).toBe(150000);
  });

  it('asks for a delivery address before offering pickup points', async () => {
    // The flow inverts under Bob Go: address first, then the points near it.
    const { svc, bobgo } = makeService({ rates: [PICKUP] });
    await expect(
      svc.quoteForListing({ listingId: 'L1', shippingMethod: 'PUDO', toLockerId: '545' }),
    ).rejects.toThrow(/delivery address/i);
    expect(bobgo.getRates).not.toHaveBeenCalled();
  });

  it('tells the buyer to retry on an outage, not that we cannot deliver', async () => {
    const { svc } = makeService({ throws: new Error('Bob Go unreachable: ETIMEDOUT') });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'TCG',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/try again/i);
  });

  it('says no route is available when the carrier simply has no rate', async () => {
    const { svc } = makeService({ rates: [] });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'TCG',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/no door-delivery rate/i);
  });

  it('does not offer a door rate when the buyer asked for a pickup point', async () => {
    const { svc } = makeService({ rates: [DOOR] });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'PUDO',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/collection point/i);
  });
});

describe('quoteCombined on the Bob Go rail', () => {
  const items = [{ listingId: 'L1', quantity: 2 }];

  it('quotes the combined parcel', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR] });
    const q = await svc.quoteCombined(items, 'TCG', { deliveryAddress: DELIVERY });
    expect(q?.priceCents).toBe(11495);
    // Stacked box: 2 x 15cm high, 2 x 2.5kg.
    const sent = bobgo.getRates.mock.calls[0][0];
    expect(sent.parcels[0].heightCm).toBe(30);
    expect(sent.parcels[0].weightKg).toBe(5);
    expect(sent.declaredValueCents).toBe(300000);
  });

  it('returns null rather than throwing when Bob Go is unreachable', async () => {
    // createOrderCheckout calls this with NO try/catch and treats null as
    // "fall back to per-line quoting". A throw here 500s a whole cart.
    const { svc } = makeService({ throws: new Error('Bob Go unreachable: ETIMEDOUT') });
    await expect(
      svc.quoteCombined(items, 'TCG', { deliveryAddress: DELIVERY }),
    ).resolves.toBeNull();
  });

  it('returns null when there is no rate', async () => {
    const { svc } = makeService({ rates: [] });
    await expect(
      svc.quoteCombined(items, 'TCG', { deliveryAddress: DELIVERY }),
    ).resolves.toBeNull();
  });

  it('returns null without a delivery address instead of throwing', async () => {
    const { svc } = makeService({ rates: [DOOR] });
    await expect(svc.quoteCombined(items, 'PUDO', {})).resolves.toBeNull();
  });
});

describe('bobgoPickupPoints', () => {
  it('returns priced, deduped, nearest-first points', async () => {
    const far = { ...PICKUP, pickupPointLocationId: 900, pickupPointDistanceKm: 9, totalPrice: 70 };
    const dupe = { ...PICKUP, totalPrice: 80 }; // same location 545, dearer
    const { svc } = makeService({ rates: [DOOR, far, PICKUP, dupe] });

    const points = await svc.bobgoPickupPoints('L1', DELIVERY);

    expect(points.map((p) => p.locationId)).toEqual([545, 900]);
    expect(points[0].priceCents).toBe(6443); // cheaper of the two for 545
    expect(points[0].serviceCode).toBe('bobgo_PP_3084_104_545_1');
  });

  it('surfaces an outage as a retryable message', async () => {
    const { svc } = makeService({ throws: new Error('Bob Go unreachable') });
    await expect(svc.bobgoPickupPoints('L1', DELIVERY)).rejects.toThrow(/try again/i);
  });
});
