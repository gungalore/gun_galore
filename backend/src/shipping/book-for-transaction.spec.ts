// ShippingService → BobGoService. Bob Go is the only courier rail.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

function makeService(over: { claimCount?: number; tx?: unknown } = {}) {
  const prisma = {
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: over.claimCount ?? 1 }),
      findUnique: jest.fn().mockResolvedValue(over.tx ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const bobgo = { createShipment: jest.fn() };
  const notifications = {
    shipmentBooked: jest.fn().mockResolvedValue(undefined),
    shipmentBookingFailed: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    bobgo as never,
  );
  return { svc, prisma, bobgo, notifications };
}

const TX = {
  id: 'TX1',
  paymentStatus: 'HELD', // P6.2 — bookForTransaction refuses non-HELD orders
  shippingMethod: 'COURIER',
  quantity: 1,
  listingPrice: 150000,
  shippingServiceCode: 'bobgo_3082_34_0',
  shippingProviderSlug: 'sandbox',
  shippingServiceLevelCode: 'ECO',
  shippedWith: [],
  seller: { firstName: 'Jan', lastName: 'P', username: 'janp', email: 's@x.co', phone: '0820000000' },
  buyer: { firstName: 'Bo', lastName: 'B', username: 'bob', email: 'b@x.co', phone: '0830000000' },
  listing: {
    title: 'Camping lantern',
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

const BOOKED = {
  shipmentId: 297,
  trackingReference: 'UASD7R7R',
  submission: 'SUBMITTED' as const,
  rawSubmissionStatus: 'submitted',
  pin: '270089',
};

describe('ShippingService.bookForTransaction', () => {
  it('books a COURIER door shipment and persists waybill + PIN', async () => {
    const { svc, prisma, bobgo } = makeService({ tx: TX });
    (bobgo.createShipment as jest.Mock).mockResolvedValue(BOOKED);

    const res = await svc.bookForTransaction('TX1');

    expect(bobgo.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceCode: 'bobgo_3082_34_0',
        providerSlug: 'sandbox',
        serviceLevelCode: 'ECO',
      }),
    );
    // persisted onto the transaction
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX1' },
        data: expect.objectContaining({
          carrierShipmentId: '297',
          carrierDropoffPin: '270089',
          trackingReference: 'UASD7R7R',
          shipmentBookedAt: expect.any(Date),
        }),
      }),
    );
    expect(res?.trackingReference).toBe('UASD7R7R');
  });

  it('passes the seller-chosen pickup date + window to Bob Go', async () => {
    const { svc, bobgo } = makeService({
      tx: {
        ...TX,
        // 06:00Z === 08:00 SAST — the start of the collection window.
        collectionNotBeforeAt: new Date('2026-09-24T06:00:00.000Z'),
        collectionWindow: '11:00-14:00',
      },
    });
    (bobgo.createShipment as jest.Mock).mockResolvedValue(BOOKED);

    await svc.bookForTransaction('TX1');

    expect(bobgo.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionMinDate: '2026-09-24T08:00:00+02:00',
        collectionAfter: '11:00:00',
        collectionBefore: '14:00:00',
      }),
    );
  });

  it('is idempotent: a lost claim (count 0) books nothing', async () => {
    const { svc, bobgo } = makeService({ claimCount: 0, tx: TX });
    const res = await svc.bookForTransaction('TX1');
    expect(res).toBeNull();
    expect(bobgo.createShipment).not.toHaveBeenCalled();
  });

  it('skips non-courier sales (DEALER_TRANSFER) and releases the claim', async () => {
    const { svc, prisma, bobgo } = makeService({
      tx: { ...TX, shippingMethod: 'DEALER_TRANSFER' },
    });
    const res = await svc.bookForTransaction('TX1');
    expect(res).toBeNull();
    expect(bobgo.createShipment).not.toHaveBeenCalled();
    // claim released
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX1' },
        data: { shipmentBookingStartedAt: null },
      }),
    );
  });

  it('fail-safe: a carrier error releases the claim, raises an alert, and never throws', async () => {
    const { svc, prisma, bobgo } = makeService({ tx: TX });
    (bobgo.createShipment as jest.Mock).mockRejectedValue(new Error('zero_balance'));

    const res = await svc.bookForTransaction('TX1');

    expect(res).toBeNull(); // resolved, not thrown
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shipmentBookingStartedAt: null } }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SHIPMENT_BOOKING_FAILED', referenceId: 'TX1' }),
      }),
    );
  });
});

describe('ShippingService.cancelForTransaction (sale reversal)', () => {
  it('alerts an admin to cancel a booked, not-yet-collected shipment by hand', async () => {
    // Bob Go exposes no cancel endpoint we can use, so the operator must
    // reclaim the charge and stop the collection in the portal.
    const { svc, prisma } = makeService({
      tx: {
        shippingMethod: 'COURIER',
        carrierShipmentId: '297',
        shipmentBookedAt: new Date('2026-01-01'),
        shippingStatus: 'PENDING',
      },
    });
    await svc.cancelForTransaction('TX1');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIPMENT_BOOKING_FAILED',
          referenceId: 'TX1',
          context: expect.stringMatching(/Bob Go portal/i),
        }),
      }),
    );
  });

  it('is a no-op when nothing was booked', async () => {
    const { svc, prisma } = makeService({
      tx: { shippingMethod: 'COURIER', carrierShipmentId: null, shipmentBookedAt: null, shippingStatus: null },
    });
    await svc.cancelForTransaction('TX1');
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('does NOT cancel once the parcel is moving — alerts an admin instead', async () => {
    const { svc, prisma } = makeService({
      tx: {
        shippingMethod: 'COURIER',
        carrierShipmentId: '297',
        shipmentBookedAt: new Date('2026-01-01'),
        shippingStatus: 'IN_TRANSIT',
      },
    });
    await svc.cancelForTransaction('TX1');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SHIPMENT_BOOKING_FAILED',
          referenceId: 'TX1',
          context: expect.stringMatching(/already IN_TRANSIT/i),
        }),
      }),
    );
  });
});
