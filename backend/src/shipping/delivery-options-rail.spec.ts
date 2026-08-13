jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// The delivery menu must look the SAME whichever rail is live.
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

    expect(opts.door?.priceCents).toBe(11495);
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
      priceCents: 12300,
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
    expect(opts.pickupPoints.map((p) => p.priceCents)).toEqual([6000, 6000]);
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
    expect(opts.door?.priceCents).toBe(12300);
    expect(opts.pickupPoints).toEqual([]);
  });
});
