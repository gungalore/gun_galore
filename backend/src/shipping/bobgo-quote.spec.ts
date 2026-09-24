jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// Quoting on the Bob Go rail — the only courier rail left.
//
// The behaviour that matters here is what a buyer sees when things go wrong.
// Both legacy clients returned null for everything, so "no rate for this route"
// and "the carrier is down" were indistinguishable — the buyer got the same
// empty shipping list and the sale was lost silently. Bob Go's client throws on
// an outage, and these tests pin down that the distinction survives. Delivery
// is door-to-door only: Bob Go may return cheaper pickup-point rates in the
// same response, and they are deliberately ignored.

const LISTING = {
  id: 'L1',
  isFirearm: false,
  collectionOnly: false,
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

// Bob Go returns pickup-point rates alongside the door rate, often cheaper.
// They must never be selected: delivery is door-to-door.
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

function makeService(
  bobgoBehaviour: { rates?: unknown[]; throws?: Error } = {},
) {
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
  const svc = new ShippingService(prisma as never, {} as never, bobgo as never);
  return { svc, bobgo, prisma };
}

describe('quoteForListing on the Bob Go door-only rail', () => {
  it('quotes the door slot from the door rate', async () => {
    const { svc } = makeService({ rates: [DOOR, PICKUP] });
    const q = await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'COURIER',
      deliveryAddress: DELIVERY,
    });
    expect(q.priceCents).toBe(11495);
    expect(q.serviceCode).toBe('bobgo_3082_34_0');
    // Without these the booking days later cannot reconstruct the rate.
    expect(q.providerSlug).toBe('sandbox');
    expect(q.serviceLevelCode).toBe('ECO');
  });

  it('ignores a cheaper pickup-point rate — delivery is door-to-door', async () => {
    // The pickup point is R50 cheaper but is not an option we offer any more.
    const { svc } = makeService({ rates: [DOOR, PICKUP] });
    const q = await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'COURIER',
      deliveryAddress: DELIVERY,
    });
    expect(q.priceCents).toBe(11495);
    expect(q.serviceCode).toBe('bobgo_3082_34_0');
  });

  it('sends the declared value in cents for the client to convert', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR] });
    await svc.quoteForListing({
      listingId: 'L1',
      shippingMethod: 'COURIER',
      deliveryAddress: DELIVERY,
    });
    expect(bobgo.getRates.mock.calls[0][0].declaredValueCents).toBe(150000);
  });

  it('asks for a delivery address before quoting a door rate', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR] });
    await expect(
      svc.quoteForListing({ listingId: 'L1', shippingMethod: 'COURIER' }),
    ).rejects.toThrow(/delivery address/i);
    expect(bobgo.getRates).not.toHaveBeenCalled();
  });

  it('tells the buyer to retry on an outage, not that we cannot deliver', async () => {
    const { svc } = makeService({ throws: new Error('Bob Go unreachable: ETIMEDOUT') });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'COURIER',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/try again/i);
  });

  it('says no route is available when the carrier simply has no rate', async () => {
    const { svc } = makeService({ rates: [] });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'COURIER',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/no door-delivery rate/i);
  });
});

describe('quoteCombined on the Bob Go rail', () => {
  const items = [{ listingId: 'L1', quantity: 2 }];

  it('quotes the combined parcel', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR] });
    const q = await svc.quoteCombined(items, 'COURIER', { deliveryAddress: DELIVERY });
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
      svc.quoteCombined(items, 'COURIER', { deliveryAddress: DELIVERY }),
    ).resolves.toBeNull();
  });

  it('returns null when there is no rate', async () => {
    const { svc } = makeService({ rates: [] });
    await expect(
      svc.quoteCombined(items, 'COURIER', { deliveryAddress: DELIVERY }),
    ).resolves.toBeNull();
  });

  it('returns null without a delivery address instead of throwing', async () => {
    const { svc } = makeService({ rates: [DOOR] });
    await expect(svc.quoteCombined(items, 'COURIER', {})).resolves.toBeNull();
  });
});

describe('deliveryOptions — the buyer decides', () => {
  it('returns the door option with our 10% delivery margin folded in', async () => {
    const { svc } = makeService({ rates: [DOOR, PICKUP] });

    const opts = await svc.deliveryOptions('L1', DELIVERY);

    // The buyer sees ONE figure: the carrier rate plus our 10% delivery
    // margin, quoted up front rather than added at checkout. quoteForListing
    // (above) still returns the BARE carrier rate — only the buyer-facing menu
    // folds the margin in.
    const withMargin = (c: number) => c + Math.round(c * 0.1);
    expect(opts.door?.priceCents).toBe(withMargin(11495));
    expect(opts.door?.carrierRateCents).toBe(11495);
    expect(opts.door?.serviceCode).toBe('bobgo_3082_34_0');
  });

  it('distinguishes "nothing serves this route" from "we could not ask"', async () => {
    const { svc } = makeService({ rates: [] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.door).toBeNull();

    const outage = makeService({ throws: new Error('Bob Go unreachable') });
    await expect(outage.svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /try again/i,
    );
  });
});

describe('the seller no longer curates the courier option', () => {
  it('still refuses a courier when the seller offered none at all', async () => {
    // Collection-only stays the seller's (and physics') call.
    const { svc } = makeService({ rates: [DOOR, PICKUP] });
    const prisma = (svc as unknown as { prisma: { listing: { findUnique: jest.Mock } } })
      .prisma;
    prisma.listing.findUnique.mockResolvedValue({
      ...LISTING,
      shippingMethods: ['COLLECTION'],
    });
    await expect(
      svc.quoteForListing({
        listingId: 'L1',
        shippingMethod: 'COURIER',
        deliveryAddress: DELIVERY,
      }),
    ).rejects.toThrow(/not available for courier/i);
  });
});
