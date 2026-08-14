jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// The delivery menu must look the SAME whichever rail is live.
//
// Every price here is the CARRIER RATE with our 10% delivery margin folded in.
// The margin was always charged; it just used to appear at checkout as a
// separate R15 line, after the buyer had chosen from a list showing the bare
// rate. One quoted figure means the number beside an option is the number that
// lands on the total.
const withMargin = (carrier: number) => carrier + Math.round(carrier * 0.1);
//
// The frontend has no way to read a feature flag and is deliberately not given
// one — so this endpoint is the seam that hides the migration. If the two rails
// answered in different shapes, the checkout would have to know which carrier
// it was talking to, and the swap would become a frontend release too.

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

function makeService(opts: {
  bobgoOn: boolean;
  rates?: unknown[];
  lockers?: unknown[];
  l2l?: unknown;
  tcgQuote?: unknown;
}) {
  const prisma = {
    listing: { findUnique: jest.fn().mockResolvedValue(LISTING) },
  };
  const bobgo = {
    getRates: jest
      .fn()
      .mockResolvedValue({ rates: opts.rates ?? [], pricingVerified: false }),
  };
  const pudo = {
    getNearbyLockers: jest.fn().mockResolvedValue(opts.lockers ?? []),
    quoteL2L: jest.fn().mockResolvedValue(opts.l2l ?? null),
  };
  const tcg = { getQuote: jest.fn().mockResolvedValue(opts.tcgQuote ?? null) };
  const svc = new ShippingService(
    prisma as never,
    {} as never,
    pudo as never,
    tcg as never,
    bobgo as never,
    { get: jest.fn().mockResolvedValue(opts.bobgoOn) } as never,
  );
  return { svc, bobgo, pudo, tcg };
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

const LOCKERS = [
  { lockerId: 'CG929', name: 'Pick n Pay Milpark', address: '1 Owl St', suburb: 'Milpark', city: 'Johannesburg', distanceKm: 0.4 },
  { lockerId: 'CG930', name: 'Engen Empire', address: '9 Empire Rd', suburb: 'Parktown', city: 'Johannesburg', distanceKm: 2.1 },
];

describe('deliveryOptions is rail-agnostic', () => {
  it('answers from Bob Go when the flag is on', async () => {
    const { svc, bobgo, pudo } = makeService({ bobgoOn: true, rates: [DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);

    expect(opts.door?.priceCents).toBe(withMargin(11495));
    expect(bobgo.getRates).toHaveBeenCalled();
    expect(pudo.getNearbyLockers).not.toHaveBeenCalled();
  });

  it('answers from Pudo + TCG when the flag is off, in the SAME shape', async () => {
    const { svc, bobgo } = makeService({
      bobgoOn: false,
      lockers: LOCKERS,
      l2l: { serviceCode: 'L2LXS - ECO', serviceName: 'Locker to locker', priceCents: 6000 },
      tcgQuote: { serviceCode: 'ECO', serviceName: 'Economy', priceCents: 12300 },
    });

    const opts = await svc.deliveryOptions('L1', DELIVERY);

    expect(bobgo.getRates).not.toHaveBeenCalled();
    expect(opts.door).toEqual({
      priceCents: withMargin(12300),
      // Carried for the fee maths only — the transaction fee is charged on the
      // carrier's rate, never on our own margin. Never displayed.
      carrierRateCents: 12300,
      serviceName: 'Economy',
      serviceCode: 'ECO',
    });
    expect(opts.pickupPoints).toHaveLength(2);
    expect(opts.pickupPoints[0].name).toBe('Pick n Pay Milpark');
    expect(opts.pickupPoints[0].serviceCode).toBe('CG929');
    expect(opts.pickupPoints[0].distanceKm).toBe(0.4);
  });

  it('prices every legacy locker from ONE quote, because the L2L rate is flat', async () => {
    const { svc, pudo } = makeService({
      bobgoOn: false,
      lockers: LOCKERS,
      l2l: { serviceCode: 'L2LXS - ECO', serviceName: 'L2L', priceCents: 6000 },
    });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(pudo.quoteL2L).toHaveBeenCalledTimes(1);
    expect(opts.pickupPoints.map((p) => p.priceCents)).toEqual([
      withMargin(6000),
      withMargin(6000),
    ]);
  });

  it('offers no legacy collection point when the parcel fits no locker', async () => {
    // quoteL2L returning null means no box fits — the same answer Bob Go gives
    // by returning no pickup-point rates at all.
    const { svc } = makeService({ bobgoOn: false, lockers: LOCKERS, l2l: null });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints).toEqual([]);
  });

  it('still returns door when the legacy locker lookup fails outright', async () => {
    const prisma = { listing: { findUnique: jest.fn().mockResolvedValue(LISTING) } };
    const svc = new ShippingService(
      prisma as never,
      {} as never,
      {
        getNearbyLockers: jest.fn().mockRejectedValue(new Error('meili down')),
        quoteL2L: jest.fn(),
      } as never,
      { getQuote: jest.fn().mockResolvedValue({ serviceCode: 'ECO', serviceName: 'Economy', priceCents: 12300 }) } as never,
      {} as never,
      { get: jest.fn().mockResolvedValue(false) } as never,
    );

    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // Losing lockers must not lose the door option too.
    expect(opts.door?.priceCents).toBe(withMargin(12300));
    expect(opts.pickupPoints).toEqual([]);
  });
});

describe('the legacy menu never offers what the legacy quote will refuse', () => {
  // deliveryOptions is unfiltered on the Bob Go rail because the choice is the
  // buyer's. On the LEGACY rail quoteForListing still honours the seller's
  // pick, so an unfiltered menu would hand the buyer a price and then 400 at
  // the Pay button — the worst possible place to discover it.
  function legacyFor(shippingMethods: string[]) {
    const prisma = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ ...LISTING, shippingMethods }),
      },
    };
    return new ShippingService(
      prisma as never,
      {} as never,
      {
        getNearbyLockers: jest.fn().mockResolvedValue(LOCKERS),
        quoteL2L: jest.fn().mockResolvedValue({
          serviceCode: 'L2LXS - ECO',
          serviceName: 'L2L',
          priceCents: 6000,
        }),
      } as never,
      {
        getQuote: jest.fn().mockResolvedValue({
          serviceCode: 'ECO',
          serviceName: 'Economy',
          priceCents: 12300,
        }),
      } as never,
      {} as never,
      { get: jest.fn().mockResolvedValue(false) } as never,
    );
  }

  it('hides door when the seller only offered lockers', async () => {
    const opts = await legacyFor(['PUDO']).deliveryOptions('L1', DELIVERY);
    expect(opts.door).toBeNull();
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
  });

  it('hides collection points when the seller only offered door', async () => {
    const opts = await legacyFor(['TCG']).deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints).toEqual([]);
    expect(opts.door).not.toBeNull();
  });

  it('offers both when the seller offered both', async () => {
    const opts = await legacyFor(['PUDO', 'TCG']).deliveryOptions('L1', DELIVERY);
    expect(opts.door).not.toBeNull();
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
  });

  it('treats an empty list as no restriction, as the quote gate does', async () => {
    const opts = await legacyFor([]).deliveryOptions('L1', DELIVERY);
    expect(opts.door).not.toBeNull();
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
  });
});

describe('the 10% delivery margin is quoted, not sprung at checkout', () => {
  it('is included in the door price the buyer picks from', async () => {
    const { svc } = makeService({ bobgoOn: true, rates: [DOOR_RATE] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // R114.95 carrier + 10%. Showing the bare rate and adding the margin
    // later is the surprise the built-in-markup model exists to remove.
    expect(opts.door?.priceCents).toBe(withMargin(11495));
  });

  it('is included on collection points too — they produce a waybill as well', async () => {
    const PICKUP = {
      ...DOOR_RATE,
      id: 3084,
      serviceCode: 'bobgo_PP_3084_104_545_1',
      serviceName: 'Bob Box Locker',
      totalPrice: 79,
      type: 'pickup-point' as const,
      pickupPointLocationId: 545,
      pickupPointDistanceKm: 1.2,
    };
    const { svc } = makeService({ bobgoOn: true, rates: [PICKUP] });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints[0].priceCents).toBe(withMargin(7900));
  });

  it('applies on the legacy rail identically', async () => {
    const { svc } = makeService({
      bobgoOn: false,
      lockers: LOCKERS,
      l2l: { serviceCode: 'L2LXS - ECO', serviceName: 'L2L', priceCents: 6000 },
      tcgQuote: { serviceCode: 'ECO', serviceName: 'Economy', priceCents: 12300 },
    });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.door?.priceCents).toBe(withMargin(12300));
    expect(opts.pickupPoints[0].priceCents).toBe(withMargin(6000));
  });
});
