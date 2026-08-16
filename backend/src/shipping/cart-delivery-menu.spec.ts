jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

/**
 * THE PROPERTY THAT MATTERS: the delivery menu the cart shows and the re-quote
 * checkout charges must agree, to the cent, for the same group.
 *
 * They are two different code paths reached minutes apart, so nothing but a
 * test keeps them honest. Before this endpoint existed the cart could not even
 * ask the question — it made the buyer choose a CARRIER instead of a delivery,
 * and consolidated locker groups then failed to quote at all.
 */

const base = {
  isFirearm: false,
  collectionOnly: false,
  isExperience: false,
  isDealListing: false,
  sellerId: 'S1',
  shippingMethods: [] as string[],
  province: 'WESTERN_CAPE',
  pickupStreet: '1 Main Road',
  pickupSuburb: 'Durbanville',
  pickupCity: 'Cape Town',
  pickupPostalCode: '7550',
  pickupLat: -33.83,
  pickupLng: 18.65,
};

const L1 = { ...base, id: 'L1', weightGrams: 2500, lengthCm: 30, widthCm: 20, heightCm: 15, price: 150000 };
const L2 = { ...base, id: 'L2', weightGrams: 1000, lengthCm: 25, widthCm: 15, heightCm: 10, price: 50000 };

const DELIVERY = {
  streetAddress: '44 Stanley Avenue',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
  province: 'GAUTENG' as never,
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
  serviceCode: 'bobgo_PP_3084_104_545_1',
  serviceName: 'Bob Box Locker - 44 on Stanley',
  type: 'pickup-point' as const,
  totalPrice: 79,
  baseRate: 79,
  pickupPointLocationId: 545,
  pickupPointDistanceKm: 1.2,
};

function makeService(listings: unknown[], rates: unknown[], flag = true) {
  const getRates: jest.Mock = jest.fn(() =>
    Promise.resolve({ rates, pricingVerified: false }),
  );
  const prisma = {
    listing: {
      findMany: jest.fn().mockResolvedValue(listings),
      findUnique: jest.fn().mockResolvedValue(listings[0]),
    },
    deal: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = new ShippingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    { getRates } as never,
    { get: jest.fn().mockResolvedValue(flag) } as never,
  );
  return { svc, getRates };
}

describe('cart delivery menu', () => {
  it('returns ONE group for two same-seller lines, flagged consolidated', async () => {
    const { svc } = makeService([L1, L2], [DOOR, PICKUP]);
    const groups = await svc.deliveryOptionsForCart(
      [{ listingId: 'L1', quantity: 1 }, { listingId: 'L2', quantity: 1 }],
      DELIVERY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].consolidated).toBe(true);
    expect(groups[0].listingIds.sort()).toEqual(['L1', 'L2']);
    expect(groups[0].door).not.toBeNull();
    expect(groups[0].pickupPoints).toHaveLength(1);
  });

  it('prices the STACKED box, not the sum of the lines', async () => {
    const { svc, getRates } = makeService([L1, L2], [DOOR]);
    await svc.deliveryOptionsForCart(
      [{ listingId: 'L1', quantity: 1 }, { listingId: 'L2', quantity: 2 }],
      DELIVERY,
    );
    const sent = getRates.mock.calls[0][0];
    // Widest footprint, summed height, summed weight.
    expect(sent.parcels[0].heightCm).toBe(15 + 10 * 2);
    expect(sent.parcels[0].weightKg).toBe((2500 + 1000 * 2) / 1000);
    expect(sent.parcels[0].lengthCm).toBe(30);
    expect(sent.declaredValueCents).toBe(150000 + 50000 * 2);
  });

  // The identity property. Same lines, same rates → same money.
  it('agrees with quoteCombined, the figure checkout actually charges', async () => {
    const { svc } = makeService([L1, L2], [DOOR, PICKUP]);
    const items = [
      { listingId: 'L1', quantity: 1 },
      { listingId: 'L2', quantity: 2 },
    ];

    const [menu] = await svc.deliveryOptionsForCart(items, DELIVERY);
    const charged = await svc.quoteCombined(items, 'TCG', {
      deliveryAddress: { ...DELIVERY, lat: 0, lng: 0 },
    });

    expect(menu.door).not.toBeNull();
    expect(charged).not.toBeNull();
    // The identity is on the CARRIER rate: the menu quotes
    // handling-inclusive (one figure for the buyer, margin folded in), while
    // quoteCombined returns the bare rate because checkout stores the margin
    // as its own column. Same rate for the same parcel is the property; the
    // margin is applied once, on one side or the other, never twice.
    expect(menu.door!.carrierRateCents).toBe(charged!.priceCents);
    expect(menu.door!.serviceCode).toBe(charged!.serviceCode);
    // And the buyer-facing figure is that rate plus the margin.
    expect(menu.door!.priceCents).toBeGreaterThan(menu.door!.carrierRateCents);
  });

  it('holds for a collection-point choice too', async () => {
    const { svc } = makeService([L1, L2], [DOOR, PICKUP]);
    const items = [{ listingId: 'L1', quantity: 1 }, { listingId: 'L2', quantity: 1 }];

    const [menu] = await svc.deliveryOptionsForCart(items, DELIVERY);
    const charged = await svc.quoteCombined(items, 'PUDO', {
      deliveryAddress: { ...DELIVERY, lat: 0, lng: 0 },
      toLockerId: 545,
    });

    expect(menu.pickupPoints[0].carrierRateCents).toBe(charged!.priceCents);
  });

  it('reports a group it cannot courier instead of failing the whole cart', async () => {
    const heavy = { ...L2, id: 'L2', collectionOnly: true };
    const { svc } = makeService([L1, heavy], [DOOR]);
    const groups = await svc.deliveryOptionsForCart(
      [{ listingId: 'L1' }, { listingId: 'L2' }],
      DELIVERY,
    );
    // Same seller, so both land in one group; the group is unquotable.
    expect(groups[0].unavailableReason).toMatch(/cannot be sent by courier/i);
    expect(groups[0].door).toBeNull();
  });

  it('offers no collection point for a Daily Deal — deals are door-only', async () => {
    const deal = { ...L1, isDealListing: true };
    const { svc } = makeService([deal], [DOOR, PICKUP]);
    // A deal ships from the supplier's warehouse, resolved by its own lookup
    // chain — stub it so this test is about the door-only RULE, not origins.
    jest
      .spyOn(svc as unknown as { dealCollectionOrigin: () => Promise<unknown> }, 'dealCollectionOrigin')
      .mockResolvedValue({
        streetAddress: '2 Warehouse Rd',
        suburb: 'Epping',
        city: 'Cape Town',
        postalCode: '7460',
        province: 'Western Cape',
      });
    const groups = await svc.deliveryOptionsForCart([{ listingId: 'L1' }], DELIVERY);
    expect(groups[0].pickupPoints).toEqual([]);
    expect(groups[0].door).not.toBeNull();
  });

  it('says options are unavailable on the legacy rail rather than inventing a price', async () => {
    const { svc } = makeService([L1], [DOOR], false);
    const groups = await svc.deliveryOptionsForCart([{ listingId: 'L1' }], DELIVERY);
    expect(groups[0].door).toBeNull();
    expect(groups[0].unavailableReason).toMatch(/unavailable/i);
  });
});
