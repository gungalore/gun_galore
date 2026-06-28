// ShippingService → PudoService → SearchService → ESM-only meilisearch.
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
  const pudo = { createShipment: jest.fn(), cancelShipment: jest.fn().mockResolvedValue(true) };
  const tcg = { createShipment: jest.fn(), cancelShipment: jest.fn().mockResolvedValue(true) };
  const notifications = {
    shipmentBooked: jest.fn().mockResolvedValue(undefined),
    shipmentBookingFailed: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    pudo as never,
    tcg as never,
  );
  return { svc, prisma, pudo, tcg };
}

const PUDO_TX = {
  id: 'TX1',
  shippingMethod: 'PUDO',
  shippingServiceCode: 'L2LXS - ECO',
  pudoPickupLockerId: 'CG929',
  seller: { firstName: 'Jan', lastName: 'P', username: 'janp', email: 's@x.co', phone: '0820000000' },
  buyer: { firstName: 'Bo', lastName: 'B', username: 'bob', email: 'b@x.co', phone: '0830000000' },
  listing: {},
  deliveryAddress: null,
};

describe('ShippingService.bookForTransaction', () => {
  it('books a PUDO L2L shipment and persists waybill + PIN', async () => {
    const { svc, prisma, pudo } = makeService({ tx: PUDO_TX });
    (pudo.createShipment as jest.Mock).mockResolvedValue({
      carrier: 'PUDO',
      shipmentId: '297',
      trackingReference: 'PUDOD000570',
      pin: '270089',
    });

    const res = await svc.bookForTransaction('TX1');

    expect(pudo.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ serviceCode: 'L2LXS - ECO', toLockerId: 'CG929' }),
    );
    // persisted onto the transaction
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX1' },
        data: expect.objectContaining({
          carrierShipmentId: '297',
          carrierDropoffPin: '270089',
          trackingReference: 'PUDOD000570',
          shipmentBookedAt: expect.any(Date),
        }),
      }),
    );
    expect(res?.trackingReference).toBe('PUDOD000570');
  });

  it('is idempotent: a lost claim (count 0) books nothing', async () => {
    const { svc, pudo } = makeService({ claimCount: 0 });
    const res = await svc.bookForTransaction('TX1');
    expect(res).toBeNull();
    expect(pudo.createShipment).not.toHaveBeenCalled();
  });

  it('skips non-courier sales (DEALER_TRANSFER) and releases the claim', async () => {
    const { svc, prisma, pudo, tcg } = makeService({
      tx: { ...PUDO_TX, shippingMethod: 'DEALER_TRANSFER' },
    });
    const res = await svc.bookForTransaction('TX1');
    expect(res).toBeNull();
    expect(pudo.createShipment).not.toHaveBeenCalled();
    expect(tcg.createShipment).not.toHaveBeenCalled();
    // claim released
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'TX1' },
        data: { shipmentBookingStartedAt: null },
      }),
    );
  });

  it('fail-safe: a carrier error releases the claim, raises an alert, and never throws', async () => {
    const { svc, prisma, pudo } = makeService({ tx: PUDO_TX });
    (pudo.createShipment as jest.Mock).mockRejectedValue(new Error('zero_balance'));

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
  it('cancels a booked, not-yet-collected PUDO shipment and clears the marker', async () => {
    const { svc, prisma, pudo } = makeService({
      tx: {
        shippingMethod: 'PUDO',
        carrierShipmentId: '297',
        shipmentBookedAt: new Date('2026-01-01'),
        shippingStatus: 'PENDING',
      },
    });
    await svc.cancelForTransaction('TX1');
    expect(pudo.cancelShipment).toHaveBeenCalledWith('297');
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shipmentBookedAt: null } }),
    );
  });

  it('is a no-op when nothing was booked', async () => {
    const { svc, pudo, tcg } = makeService({
      tx: { shippingMethod: 'PUDO', carrierShipmentId: null, shipmentBookedAt: null, shippingStatus: null },
    });
    await svc.cancelForTransaction('TX1');
    expect(pudo.cancelShipment).not.toHaveBeenCalled();
    expect(tcg.cancelShipment).not.toHaveBeenCalled();
  });

  it('does NOT cancel once the parcel is moving — alerts an admin instead', async () => {
    const { svc, prisma, pudo } = makeService({
      tx: {
        shippingMethod: 'PUDO',
        carrierShipmentId: '297',
        shipmentBookedAt: new Date('2026-01-01'),
        shippingStatus: 'IN_TRANSIT',
      },
    });
    await svc.cancelForTransaction('TX1');
    expect(pudo.cancelShipment).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SHIPMENT_BOOKING_FAILED', referenceId: 'TX1' }),
      }),
    );
  });
});
