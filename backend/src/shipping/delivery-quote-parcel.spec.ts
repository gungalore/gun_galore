jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

// THE PARCEL THAT IS QUOTED MUST BE THE PARCEL THAT IS BOOKED.
//
// booking (bookWithBobGo) builds one stacked box: weight × quantity, height ×
// quantity, declared value = the settled price. The quote used to describe a
// different parcel — one unit's weight and, on an auction, the OPENING BID —
// so the buyer paid for one parcel while the carrier billed another. These
// cases pin the two paths to the same box.

const LISTING = {
  id: 'L1',
  isFirearm: false,
  collectionOnly: false,
  isExperience: false,
  listingType: 'BUY_NOW',
  currentBid: null as number | null,
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
};

const DELIVERY = {
  streetAddress: '44 Stanley Avenue',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
  province: 'GAUTENG' as never,
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

function makeService(listing: Record<string, unknown> = {}) {
  const prisma = {
    listing: {
      findUnique: jest.fn().mockResolvedValue({ ...LISTING, ...listing }),
    },
  };
  const bobgo = {
    getRates: jest.fn().mockResolvedValue({ rates: [DOOR_RATE], pricingVerified: false }),
  };
  const svc = new ShippingService(prisma as never, {} as never, bobgo as never);
  return { svc, bobgo };
}

function parcelSent(bobgo: { getRates: jest.Mock }) {
  return bobgo.getRates.mock.calls[0][0] as {
    parcels: Array<{ weightKg: number; heightCm: number; lengthCm: number }>;
    declaredValueCents: number;
  };
}

describe('the quoted parcel', () => {
  it('quotes one unit at the listing value when nothing says otherwise', async () => {
    const { svc, bobgo } = makeService();
    await svc.deliveryOptions('L1', DELIVERY);

    const sent = parcelSent(bobgo);
    expect(sent.parcels[0].weightKg).toBe(2.5);
    expect(sent.parcels[0].heightCm).toBe(15);
    expect(sent.parcels[0].lengthCm).toBe(30);
    expect(sent.declaredValueCents).toBe(150_000);
  });

  it('stacks the parcel when the line carries more than one unit', async () => {
    const { svc, bobgo } = makeService();
    await svc.deliveryOptions('L1', DELIVERY, { quantity: 3 });

    const sent = parcelSent(bobgo);
    // weight and height stack; the footprint does not.
    expect(sent.parcels[0].weightKg).toBe(7.5);
    expect(sent.parcels[0].heightCm).toBe(45);
    expect(sent.parcels[0].lengthCm).toBe(30);
    expect(sent.declaredValueCents).toBe(450_000);
  });

  it('declares the HAMMER on an auction, not the opening bid', async () => {
    const { svc, bobgo } = makeService({
      listingType: 'AUCTION',
      price: 250_000, // opening bid
      currentBid: 500_000, // what the winner actually pays
    });
    await svc.deliveryOptions('L1', DELIVERY);

    expect(parcelSent(bobgo).declaredValueCents).toBe(500_000);
  });

  it('lets the checkout hand over the settled amount it knows', async () => {
    const { svc, bobgo } = makeService({
      listingType: 'AUCTION',
      price: 250_000,
      currentBid: 500_000,
    });
    // A runner-up offer settles at a different figure than either column.
    await svc.deliveryOptions('L1', DELIVERY, { declaredValueCents: 380_000 });

    expect(parcelSent(bobgo).declaredValueCents).toBe(380_000);
  });

  it('survives a junk quantity instead of sending NaN to the carrier', async () => {
    const { svc, bobgo } = makeService();
    await svc.deliveryOptions('L1', DELIVERY, { quantity: Number.NaN });

    const sent = parcelSent(bobgo);
    expect(Number.isFinite(sent.parcels[0].weightKg)).toBe(true);
    expect(sent.parcels[0].weightKg).toBe(2.5);
  });
});

describe('the address the carrier is asked about', () => {
  it('refuses a delivery address with no province we can name', async () => {
    const { svc, bobgo } = makeService();
    await expect(
      svc.deliveryOptions('L1', { ...DELIVERY, province: 'ATLANTIS' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bobgo.getRates).not.toHaveBeenCalled();
  });
});
