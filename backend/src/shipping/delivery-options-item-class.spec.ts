jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

/**
 * If an item can't be shipped, we don't quote a courier for it.
 *
 * POST /shipping/delivery-options is UNAUTHENTICATED — the controller carries
 * no guard beyond the global throttler — and its only gate used to be "does
 * this listing have parcel weight and dimensions". That is not a class check.
 * A firearm carries weight and dimensions (the sell form requires them), so a
 * firearm listing sailed straight past it and the endpoint returned live,
 * priced, bookable-looking door and pickup-point rates for a rifle to any
 * caller holding a listing id.
 *
 * A firearm moves as dealer stock through a licensed dealer, or the parties
 * arrange privately and both attend one. It is never a parcel on our rail.
 *
 * These assertions run against BOTH rails, because the guard sits above the
 * Bob Go / legacy fork and the legacy path was equally exposed.
 */

const BASE_LISTING = {
  id: 'L1',
  isFirearm: false,
  collectionOnly: false,
  isExperience: false,
  weightGrams: 2500,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  price: 150000,
  shippingMethods: [] as string[],
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

function makeService(listing: Record<string, unknown>, bobgoOn: boolean) {
  const prisma = {
    listing: { findUnique: jest.fn().mockResolvedValue(listing) },
  };
  const bobgo = {
    getRates: jest
      .fn()
      .mockResolvedValue({ rates: [DOOR_RATE], pricingVerified: false }),
  };
  const pudo = {
    getNearbyLockers: jest.fn().mockResolvedValue([]),
    quoteL2L: jest.fn().mockResolvedValue(null),
  };
  const tcg = {
    getQuote: jest
      .fn()
      .mockResolvedValue({ serviceCode: 'ECO', serviceName: 'Economy', priceCents: 12300 }),
  };
  const svc = new ShippingService(
    prisma as never,
    {} as never,
    pudo as never,
    tcg as never,
    bobgo as never,
    { get: jest.fn().mockResolvedValue(bobgoOn) } as never,
  );
  return { svc, bobgo, pudo, tcg };
}

describe.each([
  ['Bob Go rail', true],
  ['legacy Pudo/TCG rail', false],
])('deliveryOptions refuses non-shippable items — %s', (_name, bobgoOn) => {
  it('refuses a firearm, and never reaches the carrier', async () => {
    const { svc, bobgo, tcg } = makeService(
      { ...BASE_LISTING, isFirearm: true },
      bobgoOn,
    );
    await expect(svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /licensed dealer/i,
    );
    // The point is not just the error — no carrier call may be made at all.
    expect(bobgo.getRates).not.toHaveBeenCalled();
    expect(tcg.getQuote).not.toHaveBeenCalled();
  });

  it('refuses a collection-only item even when it has parcel dimensions', async () => {
    // Dimensions present on purpose: the old dimension gate would have passed
    // this straight through to a live quote.
    const { svc, bobgo, tcg } = makeService(
      { ...BASE_LISTING, collectionOnly: true },
      bobgoOn,
    );
    await expect(svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /cannot be couriered/i,
    );
    expect(bobgo.getRates).not.toHaveBeenCalled();
    expect(tcg.getQuote).not.toHaveBeenCalled();
  });

  it('refuses an on-site experience', async () => {
    const { svc, bobgo, tcg } = makeService(
      { ...BASE_LISTING, isExperience: true },
      bobgoOn,
    );
    await expect(svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /on-site booking/i,
    );
    expect(bobgo.getRates).not.toHaveBeenCalled();
    expect(tcg.getQuote).not.toHaveBeenCalled();
  });

  it('refuses a listing whose seller offered no courier method', async () => {
    const { svc } = makeService(
      { ...BASE_LISTING, shippingMethods: ['COLLECTION'] },
      bobgoOn,
    );
    await expect(svc.deliveryOptions('L1', DELIVERY)).rejects.toThrow(
      /not available for courier delivery/i,
    );
  });

  it('still quotes an ordinary shippable listing', async () => {
    // Guard must not over-reach: the normal case has to keep working, and an
    // empty shippingMethods array means "no restriction", not "no courier".
    const { svc } = makeService({ ...BASE_LISTING }, bobgoOn);
    const opts = await svc.deliveryOptions('L1', DELIVERY);
    expect(opts.door?.priceCents).toBeGreaterThan(0);
  });
});
