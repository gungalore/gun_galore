jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// Recording a failed shipment, billing the seller when it was their error, and
// letting them rebook once they have fixed it.

const FAILED_AT = new Date('2026-08-13T09:00:00Z');

function makeService(tx: Record<string, unknown> | null) {
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(tx),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    adminAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const svc = new ShippingService(
    prisma as never,
    { shipmentBooked: jest.fn() } as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue(false) } as never,
  );
  return { svc, prisma };
}

describe('recordShipmentFailure', () => {
  const TX = {
    id: 'TX1',
    shippingCost: 11495,
    failedShipmentChargeCents: 0,
    sellerId: 'S1',
  };

  it("bills the seller for a parcel that did not match its measurements", async () => {
    const { svc, prisma } = makeService(TX);
    const out = await svc.recordShipmentFailure('TX1', 'PARCEL_TOO_LARGE');

    expect(out).toEqual({ charged: true, chargeCents: 11495 });
    const data = prisma.transaction.update.mock.calls[0][0].data;
    expect(data.failedShipmentChargeCents).toEqual({ increment: 11495 });
    expect(data.shipmentFailureReason).toBe('PARCEL_TOO_LARGE');
  });

  it('accumulates, so a second failure adds a second charge', async () => {
    // increment, not assignment — two wasted collections cost twice.
    const { svc, prisma } = makeService({ ...TX, failedShipmentChargeCents: 11495 });
    await svc.recordShipmentFailure('TX1', 'PARCEL_OVERWEIGHT');
    expect(
      prisma.transaction.update.mock.calls[0][0].data.failedShipmentChargeCents,
    ).toEqual({ increment: 11495 });
  });

  it('does not bill the seller for a carrier failure', async () => {
    const { svc, prisma } = makeService(TX);
    const out = await svc.recordShipmentFailure('TX1', 'CARRIER_ERROR');
    expect(out).toEqual({ charged: false, chargeCents: 0 });
    expect(
      prisma.transaction.update.mock.calls[0][0].data.failedShipmentChargeCents,
    ).toEqual({ increment: 0 });
  });

  it('does not bill on an unexplained failure', async () => {
    const { svc } = makeService(TX);
    expect((await svc.recordShipmentFailure('TX1', 'OTHER')).charged).toBe(false);
  });
});

describe('rebookShipment', () => {
  const base = {
    id: 'TX1',
    paymentStatus: 'HELD',
    shipmentFailureReason: 'PARCEL_TOO_LARGE',
    shipmentFailureAt: FAILED_AT,
    listing: {
      weightGrams: 2500,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      updatedAt: FAILED_AT,
    },
  };

  it('refuses until the seller actually re-measures', async () => {
    // Having dimensions is what got us here — they must have CHANGED since.
    const { svc, prisma } = makeService(base);
    const out = await svc.rebookShipment('TX1');
    expect(out.rebooked).toBe(false);
    expect(out.reason).toMatch(/update the parcel size/i);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('clears the dead booking once the listing has been corrected', async () => {
    const { svc, prisma } = makeService({
      ...base,
      listing: { ...base.listing, updatedAt: new Date('2026-08-13T10:00:00Z') },
    });
    await svc.rebookShipment('TX1');

    const data = prisma.transaction.update.mock.calls[0][0].data;
    // A dead waybill left on the row keeps showing the seller a shipment that
    // failed, and would send cancelForTransaction after a stale shipment.
    expect(data.trackingReference).toBeNull();
    expect(data.carrierShipmentId).toBeNull();
    expect(data.carrierProvider).toBeNull();
    expect(data.shipmentBookedAt).toBeNull();
    expect(data.shipmentBookingStartedAt).toBeNull();
    expect(data.shipmentRebookCount).toEqual({ increment: 1 });
  });

  it('keeps the failure record and the charge when rebooking', async () => {
    // The reason and the money owed are the record of what happened. Only the
    // booking is reset.
    const { svc, prisma } = makeService({
      ...base,
      listing: { ...base.listing, updatedAt: new Date('2026-08-13T10:00:00Z') },
    });
    await svc.rebookShipment('TX1');
    const data = prisma.transaction.update.mock.calls[0][0].data;
    expect(data.shipmentFailureReason).toBeUndefined();
    expect(data.failedShipmentChargeCents).toBeUndefined();
  });

  it('allows a rebook straight away where there is nothing to re-measure', async () => {
    const { svc, prisma } = makeService({
      ...base,
      shipmentFailureReason: 'SELLER_UNAVAILABLE',
    });
    await svc.rebookShipment('TX1');
    expect(prisma.transaction.update).toHaveBeenCalled();
  });

  it('refuses when the funds are no longer held', async () => {
    const { svc, prisma } = makeService({ ...base, paymentStatus: 'REFUNDED' });
    const out = await svc.rebookShipment('TX1');
    expect(out.rebooked).toBe(false);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('refuses when nothing was ever marked as failed', async () => {
    const { svc } = makeService({
      ...base,
      shipmentFailureAt: null,
      shipmentFailureReason: null,
    });
    expect((await svc.rebookShipment('TX1')).rebooked).toBe(false);
  });
});
