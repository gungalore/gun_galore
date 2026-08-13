// ShippingService → PudoService → SearchService → ESM-only meilisearch.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// Booking with the Bob Go rail ON.
//
// The behaviour under test is the one thing Pudo and TCG could never do:
// return successfully from a booking the courier has NOT agreed to. Everything
// here is about making sure the seller is not told a parcel is on its way when
// it is not.

function makeService(over: { tx?: unknown } = {}) {
  const prisma = {
    transaction: {
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
  const bobgo = {
    createShipment: jest.fn(),
    listShipments: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    shipmentBooked: jest.fn().mockResolvedValue(undefined),
    shipmentBookingFailed: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    { createShipment: jest.fn() } as never,
    { createShipment: jest.fn() } as never,
    bobgo as never,
    { get: jest.fn().mockResolvedValue(true) } as never, // bobgo_enabled ON
  );
  return { svc, prisma, bobgo, notifications };
}

const TX = {
  id: 'TX9',
  paymentStatus: 'HELD',
  shippingMethod: 'TCG',
  quantity: 1,
  listingPrice: 150000,
  shippingServiceCode: 'bobgo_3082_34_0',
  shippingProviderSlug: 'sandbox',
  shippingServiceLevelCode: 'ECO',
  shippedWith: [],
  seller: {
    firstName: 'Jan',
    lastName: 'P',
    username: 'janp',
    email: 's@x.co',
    phone: '0820000000',
  },
  buyer: {
    firstName: 'Bo',
    lastName: 'B',
    username: 'bob',
    email: 'b@x.co',
    phone: '0830000000',
  },
  listing: {
    title: 'Camping lantern',
    isDealListing: false,
    weightGrams: 2500,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    pickupStreet: '1 Main Road',
    pickupSuburb: 'Durbanville',
    pickupCity: 'Cape Town',
    pickupPostalCode: '7550',
    pickupLat: -33.83,
    pickupLng: 18.65,
    province: 'WESTERN_CAPE',
  },
  deliveryAddress: {
    streetAddress: '44 Stanley Avenue',
    suburb: 'Milpark',
    city: 'Johannesburg',
    province: 'GAUTENG',
    postalCode: '2092',
  },
};

const CREATED = {
  shipmentId: 16623,
  trackingReference: 'UASD7R7R',
  rawSubmissionStatus: 'submitted',
  submission: 'SUBMITTED' as const,
};

describe('bookForTransaction with the Bob Go rail', () => {
  it('books, stamps carrierProvider, and tells the seller', async () => {
    const { svc, prisma, bobgo, notifications } = makeService({ tx: TX });
    bobgo.createShipment.mockResolvedValue(CREATED);

    const res = await svc.bookForTransaction('TX9');

    expect(res?.provider).toBe('BOBGO');
    const written = prisma.transaction.update.mock.calls.at(-1)![0].data;
    expect(written.carrierProvider).toBe('BOBGO');
    expect(written.shipmentBookedAt).toBeInstanceOf(Date);
    expect(notifications.shipmentBooked).toHaveBeenCalled();
  });

  it('sends the declared value in RAND, not cents', async () => {
    // R1,500 listing. Sending 150000 would declare a R150,000 parcel and
    // inflate liability cover on every order.
    const { svc, bobgo } = makeService({ tx: TX });
    bobgo.createShipment.mockResolvedValue(CREATED);
    await svc.bookForTransaction('TX9');
    expect(bobgo.createShipment.mock.calls[0][0].declaredValueCents).toBe(150000);
  });

  it('replays the FULL rate key the quote captured', async () => {
    const { svc, bobgo } = makeService({ tx: TX });
    bobgo.createShipment.mockResolvedValue(CREATED);
    await svc.bookForTransaction('TX9');
    const sent = bobgo.createShipment.mock.calls[0][0];
    expect(sent.serviceCode).toBe('bobgo_3082_34_0');
    expect(sent.providerSlug).toBe('sandbox');
    expect(sent.serviceLevelCode).toBe('ECO');
  });

  describe('when the courier refuses a shipment Bob Go already created', () => {
    const REFUSED = {
      shipmentId: 16623,
      trackingReference: 'UASD7R7R',
      rawSubmissionStatus: 'no-rates',
      submission: 'FAILED' as const,
      failedReason: 'No valid rates received from Demo Couriers',
    };

    it('does NOT mark the order shipped', async () => {
      const { svc, prisma, bobgo } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(REFUSED);

      await svc.bookForTransaction('TX9');

      const stamped = prisma.transaction.update.mock.calls.some(
        (c) => c[0].data?.shipmentBookedAt,
      );
      expect(stamped).toBe(false);
    });

    it('does NOT send the seller a waybill SMS', async () => {
      // This SMS is sent critical:true — it bypasses the seller's SMS mute, so
      // a false one is the single most damaging thing this path can do.
      const { svc, bobgo, notifications } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(REFUSED);
      await svc.bookForTransaction('TX9');
      expect(notifications.shipmentBooked).not.toHaveBeenCalled();
    });

    it('releases the claim so the sale can be dispatched manually', async () => {
      const { svc, prisma, bobgo } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(REFUSED);
      await svc.bookForTransaction('TX9');
      const released = prisma.transaction.update.mock.calls.some(
        (c) => c[0].data?.shipmentBookingStartedAt === null,
      );
      expect(released).toBe(true);
    });
  });

  describe('when the courier has not answered yet', () => {
    const PENDING = {
      shipmentId: 16624,
      trackingReference: 'PEND1234',
      rawSubmissionStatus: 'processing',
      submission: 'PENDING' as const,
    };

    it('records the shipment but does not claim it is booked', async () => {
      const { svc, prisma, bobgo } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(PENDING);

      await svc.bookForTransaction('TX9');

      const written = prisma.transaction.update.mock.calls.at(-1)![0].data;
      expect(written.carrierShipmentId).toBe('16624');
      expect(written.carrierProvider).toBe('BOBGO');
      expect(written.shipmentBookedAt).toBeUndefined();
    });

    it('tells nobody yet', async () => {
      const { svc, bobgo, notifications } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(PENDING);
      await svc.bookForTransaction('TX9');
      expect(notifications.shipmentBooked).not.toHaveBeenCalled();
    });

    it('keeps the booking claim so nothing double-books it', async () => {
      // Releasing here would let a retry create a SECOND shipment, and a
      // second wallet charge, while the first is still in flight.
      const { svc, prisma, bobgo } = makeService({ tx: TX });
      bobgo.createShipment.mockResolvedValue(PENDING);
      await svc.bookForTransaction('TX9');
      const released = prisma.transaction.update.mock.calls.some(
        (c) => c[0].data?.shipmentBookingStartedAt === null,
      );
      expect(released).toBe(false);
    });
  });

  it('refuses to book a row quoted before the rail was switched on', async () => {
    // No provider/service-level snapshot means the booking would have to guess
    // a provider. Fail into the manual fallback instead.
    const { svc, bobgo } = makeService({
      tx: { ...TX, shippingProviderSlug: null, shippingServiceLevelCode: null },
    });
    const res = await svc.bookForTransaction('TX9');
    expect(bobgo.createShipment).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });

  it('refuses to book without a delivery address', async () => {
    // Legacy Pudo orders never captured one; booking to nowhere is worse than
    // failing into manual dispatch.
    const { svc, bobgo } = makeService({ tx: { ...TX, deliveryAddress: null } });
    const res = await svc.bookForTransaction('TX9');
    expect(bobgo.createShipment).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });
});

describe('resolvePendingBobGoBookings', () => {
  const PENDING_ROW = {
    id: 'TX9',
    carrierShipmentId: '16624',
    shipmentBookingStartedAt: new Date(),
  };

  it('finishes a booking once the courier accepts it', async () => {
    const { svc, prisma, bobgo, notifications } = makeService();
    prisma.transaction.findMany.mockResolvedValue([PENDING_ROW]);
    prisma.transaction.findUnique.mockResolvedValue({
      shippingMethod: 'TCG',
      trackingReference: 'PEND1234',
      carrierDropoffPin: null,
      listing: { title: 'Lantern', isDealListing: false },
      seller: TX.seller,
    });
    bobgo.listShipments.mockResolvedValue([
      {
        shipmentId: 16624,
        trackingReference: 'PEND1234',
        submission: 'SUBMITTED',
        rawSubmissionStatus: 'submitted',
      },
    ]);

    const out = await svc.resolvePendingBobGoBookings();

    expect(out.booked).toBe(1);
    expect(prisma.transaction.update.mock.calls[0][0].data.shipmentBookedAt)
      .toBeInstanceOf(Date);
    // The seller hears about it HERE — the first moment a courier agreed.
    expect(notifications.shipmentBooked).toHaveBeenCalled();
  });

  it('clears the carrier fields when the courier refuses', async () => {
    const { svc, prisma, bobgo } = makeService();
    prisma.transaction.findMany.mockResolvedValue([PENDING_ROW]);
    bobgo.listShipments.mockResolvedValue([
      {
        shipmentId: 16624,
        trackingReference: 'PEND1234',
        submission: 'FAILED',
        rawSubmissionStatus: 'no-rates',
        failedReason: 'No valid rates received',
      },
    ]);

    const out = await svc.resolvePendingBobGoBookings();

    expect(out.failed).toBe(1);
    const data = prisma.transaction.update.mock.calls[0][0].data;
    // A tracking reference for a refused shipment is a dead waybill in front
    // of a buyer — it must not survive.
    expect(data.trackingReference).toBeNull();
    expect(data.carrierShipmentId).toBeNull();
    expect(data.shipmentBookingStartedAt).toBeNull();
  });

  it('touches nothing when Bob Go is unreachable', async () => {
    // An outage is not a refusal. Treating it as one would refund live parcels.
    const { svc, prisma, bobgo } = makeService();
    prisma.transaction.findMany.mockResolvedValue([PENDING_ROW]);
    bobgo.listShipments.mockRejectedValue(new Error('ETIMEDOUT'));

    const out = await svc.resolvePendingBobGoBookings();

    expect(out.stillPending).toBe(1);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('leaves a row alone when its shipment is missing from the listing', async () => {
    const { svc, prisma, bobgo } = makeService();
    prisma.transaction.findMany.mockResolvedValue([PENDING_ROW]);
    bobgo.listShipments.mockResolvedValue([
      { shipmentId: 99999, trackingReference: 'OTHER', submission: 'SUBMITTED' },
    ]);

    const out = await svc.resolvePendingBobGoBookings();

    expect(out.stillPending).toBe(1);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('costs one request no matter how many rows are pending', async () => {
    const { svc, prisma, bobgo } = makeService();
    prisma.transaction.findMany.mockResolvedValue([
      PENDING_ROW,
      { ...PENDING_ROW, id: 'TX10', carrierShipmentId: '16625' },
      { ...PENDING_ROW, id: 'TX11', carrierShipmentId: '16626' },
    ]);
    bobgo.listShipments.mockResolvedValue([]);

    await svc.resolvePendingBobGoBookings();

    expect(bobgo.listShipments).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when no bookings are pending', async () => {
    const { svc, bobgo } = makeService();
    const out = await svc.resolvePendingBobGoBookings();
    expect(out.checked).toBe(0);
    expect(bobgo.listShipments).not.toHaveBeenCalled();
  });
});
