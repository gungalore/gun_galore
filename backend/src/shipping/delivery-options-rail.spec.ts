jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// Delivery is door-to-door only, through Bob Go.
//
// This file used to be about the two-rail swap; there is one rail now, so what
// it pins down is the SHAPE of the buyer-facing menu and the pricing rule that
// used to be split across the checkout: the 10% delivery margin is folded into
// the one figure the buyer sees, rather than sprung as a separate line at the
// Pay button. Bob Go returns every provider's door rates together, and our
// policy is to show the buyer the cheapest.
//
// Every price here is the CARRIER RATE with our 10% delivery margin folded in.

const withMargin = (carrier: number) => carrier + Math.round(carrier * 0.1);

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

function makeService(opts: { rates?: unknown[]; throws?: Error } = {}) {
  const prisma = {
    listing: { findUnique: jest.fn().mockResolvedValue(LISTING) },
  };
  const bobgo = {
    getRates: opts.throws
      ? jest.fn().mockRejectedValue(opts.throws)
      : jest
          .fn()
          .mockResolvedValue({ rates: opts.rates ?? [], pricingVerified: false }),
  };
  const svc = new ShippingService(prisma as never, {} as never, bobgo as never);
  return { svc, bobgo };
}

const DOOR_RATE = {
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

const CHEAPER_DOOR_RATE = {
  ...DOOR_RATE,
  id: 3083,
  serviceCode: 'bobgo_3083_34_0',
  serviceName: 'Economy shipping',
  totalPrice: 99.99,
  baseRate: 99.99,
};

describe('deliveryOptions is door-only', () => {
  it('answers with the cheapest Bob Go door rate', async () => {
    const { svc, bobgo } = makeService({ rates: [DOOR_RATE, CHEAPER_DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);

    expect(opts.door?.priceCents).toBe(withMargin(9999));
    expect(opts.door?.serviceCode).toBe('bobgo_3083_34_0');
    expect(bobgo.getRates).toHaveBeenCalled();
  });

  it('offers nothing when the carrier has no door rate for the route', async () => {
    // A null door is "no rate for this route", not an error.
    const { svc } = makeService({ rates: [] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.door).toBeNull();
  });

  it('distinguishes an outage from no rate — the buyer is told to retry', async () => {
    const { svc } = makeService({ throws: new Error('Bob Go unreachable') });
    await expect(svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /try again/i,
    );
  });
});

describe('the 10% delivery margin is quoted, not sprung at checkout', () => {
  it('is included in the door price the buyer picks from', async () => {
    const { svc } = makeService({ rates: [DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // R114.95 carrier + 10%. Showing the bare rate and adding the margin
    // later is the surprise the built-in-markup model exists to remove.
    expect(opts.door?.priceCents).toBe(withMargin(11495));
  });

  it('exposes the carrier rate separately so fees are not charged on our margin', async () => {
    const { svc } = makeService({ rates: [DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // The transaction fee is charged on the CARRIER rate only; the checkout
    // preview needs both numbers to agree with the server to the cent.
    expect(opts.door?.carrierRateCents).toBe(11495);
    expect(opts.door?.priceCents).toBeGreaterThan(opts.door!.carrierRateCents);
  });
});

// Three buyer options from ONE Bob Go reply: cheapest door, fastest door, and
// the nearest Pargo counters.
const SAME_DAY_DOOR = {
  ...DOOR_RATE,
  id: 4000,
  serviceCode: 'bobgo_4000_2_0',
  serviceName: 'Local Same-day',
  providerSlug: 'tcg',
  serviceLevelCode: 'LSP',
  totalPrice: 200,
  baseRate: 200,
};

const PP = (id: number, dist: number, price = 80) => ({
  id,
  serviceCode: `bobgo_PP_${id}`,
  serviceName: 'Pargo pickup point',
  totalPrice: price,
  baseRate: price,
  currency: 'ZAR',
  type: 'pickup-point' as const,
  serviceLevelCode: 'BOXL-S',
  providerSlug: 'pargo',
  pickupPointLocationId: id,
  pickupPointDistanceKm: dist,
  description: `Counter ${id}`,
  liabilityCoverPrice: 0,
  surchargeTotal: 0,
});

describe('three buyer options', () => {
  it('offers the fastest door separately from the cheapest', async () => {
    const { svc } = makeService({
      rates: [DOOR_RATE, CHEAPER_DOOR_RATE, SAME_DAY_DOOR],
    });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.door?.serviceCode).toBe('bobgo_3083_34_0'); // cheapest
    expect(opts.fastestDoor?.serviceCode).toBe('bobgo_4000_2_0'); // same-day
  });

  it('lists the nearest 5 pickup points, ascending by distance', async () => {
    const { svc } = makeService({
      rates: [PP(1, 2.9), PP(2, 0.6), PP(3, 0.7), PP(4, 1.0), PP(5, 2.7), PP(6, 5.0)],
    });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.storePickup.map((p) => p.pickupPointLocationId)).toEqual([
      2, 3, 4, 5, 1,
    ]);
    expect(opts.storePickup).toHaveLength(5);
    // The booking must replay the counter, so the id + provider travel with it.
    expect(opts.storePickup[0].providerSlug).toBe('pargo');
  });

  it('empty storePickup (not an error) when no counter covers the route', async () => {
    const { svc } = makeService({ rates: [DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.storePickup).toEqual([]);
  });

  it('server re-quotes and resolves the selected Store Pickup counter', async () => {
    const { svc } = makeService({ rates: [PP(7, 0.7, 98.39)] });
    const quote = await svc.quoteForSelection('L1', DELIVERY, {
      deliveryOption: 'STORE_PICKUP',
      pickupPointLocationId: 7,
    });
    expect(quote).toMatchObject({
      deliveryOption: 'STORE_PICKUP',
      pickupPointLocationId: 7,
      providerSlug: 'pargo',
      serviceCode: 'bobgo_PP_7',
      priceCents: 9839,
    });
  });

  it('refuses a pickup-point id that is not in the fresh rate menu', async () => {
    const { svc } = makeService({ rates: [PP(7, 0.7)] });
    await expect(
      svc.quoteForSelection('L1', DELIVERY, {
        deliveryOption: 'STORE_PICKUP',
        pickupPointLocationId: 99,
      }),
    ).rejects.toThrow(/no longer available/i);
  });
});
