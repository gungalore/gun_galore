// bookForTransaction's TCG collection origin.
//
// The origin is the seller's own pickup* columns on the listing, and the
// collection contact is the SELLER — the party the courier phones at the door.
// Getting this wrong couriers the parcel from the wrong address (or from
// nowhere), which is silent until the driver arrives, so it is pinned here.
//
// Legacy Pudo/TCG rail (bobgo_enabled OFF) — the branch that calls
// tcg.createShipment directly. Idioms follow book-for-transaction.spec.ts:
// top-of-file meilisearch stub, a hand-built prisma double, direct
// ShippingService instantiation with 'as never' stubs.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

const DELIVERY = {
  streetAddress: '1 Buyer St',
  suburb: 'Rondebosch',
  city: 'Cape Town',
  postalCode: '7700',
  province: 'WESTERN_CAPE',
  lat: -33.96,
  lng: 18.47,
};

// A paid+HELD, accepted TCG sale with a complete seller pickup address.
const SELLER_TX = {
  id: 'TXS1',
  paymentStatus: 'HELD',
  shippingMethod: 'TCG',
  shippingServiceCode: 'ECO',
  listingId: 'L-ORD',
  quantity: 1,
  listingPrice: 50000,
  pudoPickupLockerId: null,
  deliveryAddress: DELIVERY,
  listing: {
    title: 'Used Scope',
    province: 'WESTERN_CAPE',
    weightGrams: 800,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 8,
    pickupStreet: '5 Seller Ave',
    pickupSuburb: 'Green Point',
    pickupCity: 'Cape Town',
    pickupPostalCode: '8005',
    pickupLat: -33.9,
    pickupLng: 18.4,
  },
  buyer: {
    firstName: 'Bo',
    lastName: 'B',
    username: 'bob',
    email: 'b@x.co',
    phone: '0830000000',
  },
  seller: {
    firstName: 'Jan',
    lastName: 'P',
    username: 'janp',
    email: 's@x.co',
    phone: '0820000000',
  },
  shippedWith: [],
};

function makeService(over: { tx?: unknown } = {}) {
  const prisma = {
    transaction: {
      // bookForTransaction reads the tx twice (shipsWithId probe, then the
      // full include). One resolver serves both — the probe just reads
      // shipsWithId (undefined on this fixture → not a sibling).
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(over.tx ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const pudo = { createShipment: jest.fn(), cancelShipment: jest.fn() };
  const tcg = {
    createShipment: jest.fn().mockResolvedValue({
      carrier: 'TCG',
      shipmentId: '8881',
      trackingReference: 'TCG12345',
    }),
    cancelShipment: jest.fn(),
  };
  const notifications = {
    shipmentBooked: jest.fn().mockResolvedValue(undefined),
    shipmentBookingFailed: jest.fn().mockResolvedValue(undefined),
  };
  const bobgo = { createShipment: jest.fn(), listShipments: jest.fn() };
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    pudo as never,
    tcg as never,
    bobgo as never,
    // Flag OFF — the legacy TCG rail.
    { get: jest.fn().mockResolvedValue(false) } as never,
  );
  return { svc, prisma, pudo, tcg, notifications };
}

describe('bookForTransaction — TCG collection origin is the seller pickup address', () => {
  it('books with the seller pickup* columns as the collection (from) address', async () => {
    const { svc, tcg, pudo } = makeService({ tx: SELLER_TX });

    const res = await svc.bookForTransaction('TXS1');

    const arg = tcg.createShipment.mock.calls[0][0];
    expect(arg.from).toEqual(
      expect.objectContaining({
        streetAddress: '5 Seller Ave',
        suburb: 'Green Point',
        city: 'Cape Town',
        postalCode: '8005',
        // Prisma enum mapped to TCG's long-form province name.
        province: 'Western Cape',
      }),
    );
    // A seller pickup is residential — no business/company decoration.
    expect(arg.from.company).toBeUndefined();
    expect(arg.from.type).toBeUndefined();
    expect(pudo.createShipment).not.toHaveBeenCalled();
    expect(res?.trackingReference).toBe('TCG12345');
  });

  it('routes the courier to the buyer delivery address (to)', async () => {
    const { svc, tcg } = makeService({ tx: SELLER_TX });
    await svc.bookForTransaction('TXS1');
    expect(tcg.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.objectContaining({
          streetAddress: '1 Buyer St',
          city: 'Cape Town',
        }),
      }),
    );
  });

  it('uses the SELLER as the collection contact the courier phones', async () => {
    const { svc, tcg } = makeService({ tx: SELLER_TX });
    await svc.bookForTransaction('TXS1');
    const arg = tcg.createShipment.mock.calls[0][0];
    expect(arg.collectionContact).toEqual(
      expect.objectContaining({ name: 'Jan P', mobile: '0820000000' }),
    );
  });

  it('fail-safe: a seller with no phone books nothing and alerts an admin', async () => {
    const { svc, tcg, prisma } = makeService({
      tx: { ...SELLER_TX, seller: { ...SELLER_TX.seller, phone: null } },
    });

    const res = await svc.bookForTransaction('TXS1');

    expect(res).toBeNull(); // resolved, not thrown
    expect(tcg.createShipment).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIPMENT_BOOKING_FAILED',
          referenceId: 'TXS1',
        }),
      }),
    );
    // Claim released so an admin can retry.
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shipmentBookingStartedAt: null } }),
    );
  });

  it('fail-safe: an incomplete seller pickup address books nothing', async () => {
    const { svc, tcg } = makeService({
      tx: {
        ...SELLER_TX,
        listing: { ...SELLER_TX.listing, pickupStreet: null },
      },
    });

    const res = await svc.bookForTransaction('TXS1');

    expect(res).toBeNull();
    expect(tcg.createShipment).not.toHaveBeenCalled();
  });
});
