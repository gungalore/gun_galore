jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// The delivery menu used to look the SAME whichever rail was live.
//
// 🚨 THAT IS NO LONGER TRUE, AND THE ASYMMETRY IS DELIBERATE. The legacy rail's
// door leg was The Courier Guy's, and that integration was retired (operator
// 2026-09-04). Bob Go serves the DOOR slot now — so with bobgo_enabled OFF
// there is no door option at all, only Pudo lockers. The pickup-point leg is
// still rail-agnostic; the door leg is Bob Go or nothing.
//
// ⚠️ OPERATIONAL CONSEQUENCE, recorded here because this file is where someone
// will look: flipping bobgo_enabled off is no longer invisible to the buyer.
// It used to be a carrier swap behind an identical menu; it is now a feature
// reduction, and door parcels stop being sellable until the flag goes back on.
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
  const svc = new ShippingService(
    prisma as never,
    {} as never,
    pudo as never,
    bobgo as never,
    { get: jest.fn().mockResolvedValue(opts.bobgoOn) } as never,
  );
  return { svc, bobgo, pudo };
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

  it('answers from Pudo when the flag is off — lockers only, no door', async () => {
    const { svc, bobgo } = makeService({
      bobgoOn: false,
      lockers: LOCKERS,
      l2l: { serviceCode: 'L2LXS - ECO', serviceName: 'Locker to locker', priceCents: 6000 },
    });

    const opts = await svc.deliveryOptions('L1', DELIVERY);

    expect(bobgo.getRates).not.toHaveBeenCalled();
    // The pickup-point leg is still shape-identical across both rails, which is
    // what keeps the checkout from needing to know which carrier answered.
    // The door leg is not, and cannot be: nothing on this rail can quote one.
    expect(opts.door).toBeNull();
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

  it('survives a legacy locker lookup failing outright', async () => {
    const prisma = { listing: { findUnique: jest.fn().mockResolvedValue(LISTING) } };
    const svc = new ShippingService(
      prisma as never,
      {} as never,
      {
        getNearbyLockers: jest.fn().mockRejectedValue(new Error('meili down')),
        quoteL2L: jest.fn(),
      } as never,
      {} as never,
      { get: jest.fn().mockResolvedValue(false) } as never,
    );

    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // This used to assert that losing lockers must not lose the door option
    // too. There is no door option left on this rail to lose, so what the case
    // now protects is that a carrier outage still RESOLVES to an empty menu
    // rather than throwing — the checkout renders "no delivery options"
    // instead of a 500.
    expect(opts.pickupPoints).toEqual([]);
    expect(opts.door).toBeNull();
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
      {} as never,
      { get: jest.fn().mockResolvedValue(false) } as never,
    );
  }

  it('hides door when the seller only offered lockers', async () => {
    const opts = await legacyFor(['PUDO']).deliveryOptions('L1', DELIVERY);
    expect(opts.door).toBeNull();
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
  });

  it('leaves a door-only seller with NOTHING on the legacy rail', async () => {
    // ⚠️ Worth stating outright rather than hiding behind a null check: a
    // seller who offered only door delivery becomes unsellable the moment
    // bobgo_enabled goes off. Their own restriction still hides the lockers,
    // and the door leg no longer exists to fill the gap.
    const opts = await legacyFor(['TCG']).deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints).toEqual([]);
    expect(opts.door).toBeNull();
  });

  it('offers only the lockers when the seller offered both', async () => {
    const opts = await legacyFor(['PUDO', 'TCG']).deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
    expect(opts.door).toBeNull();
  });

  it('treats an empty list as no restriction, as the quote gate does', async () => {
    // "No restriction" still means the seller placed none — it does not
    // conjure a door option the rail cannot quote.
    const opts = await legacyFor([]).deliveryOptions('L1', DELIVERY);
    expect(opts.pickupPoints.length).toBeGreaterThan(0);
    expect(opts.door).toBeNull();
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

  it('applies on the legacy rail identically, on the leg it still has', async () => {
    const { svc } = makeService({
      bobgoOn: false,
      lockers: LOCKERS,
      l2l: { serviceCode: 'L2LXS - ECO', serviceName: 'L2L', priceCents: 6000 },
    });
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    // The margin is a pricing rule, not a carrier feature — losing the door
    // leg must not quietly change what a locker costs.
    expect(opts.pickupPoints[0].priceCents).toBe(withMargin(6000));
    expect(opts.door).toBeNull();
  });
});
