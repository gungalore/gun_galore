// DD-F4 — a Daily Deal (isDealListing) TCG booking collects from the deal's
// SUPPLIER warehouse (the house seller row has no address/phone), while an
// ordinary sale still collects from the seller's own pickup* columns. These
// specs pin bookForTransaction's TCG collection-origin branch
// (shipping.service.ts :636-679): the wrong origin would courier the parcel
// from GG's non-existent address or leak/ignore the supplier warehouse.
//
// Clone of book-for-transaction.spec.ts idioms: top-of-file meilisearch stub,
// a hand-built prisma double, direct ShippingService instantiation with
// 'as never' stubs, and expect.objectContaining on the carrier call shape.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ShippingService } from './shipping.service';

// A complete supplier warehouse (deal collection origin). Province is the
// Prisma enum VALUE — the service maps it to TCG's long-form name.
const SUPPLIER = {
  name: 'Acme Distribution',
  contactPerson: 'Wendy Warehouse',
  email: 'wendy@acme.co',
  phone: '0210000000',
  warehouseStreet: '10 Industrial Rd',
  warehouseSuburb: 'Epping',
  warehouseCity: 'Cape Town',
  warehouseProvince: 'WESTERN_CAPE',
  warehousePostalCode: '7460',
  warehouseLat: -33.93,
  warehouseLng: 18.53,
};

const DELIVERY = {
  streetAddress: '1 Buyer St',
  suburb: 'Rondebosch',
  city: 'Cape Town',
  postalCode: '7700',
  province: 'WESTERN_CAPE',
  lat: -33.96,
  lng: 18.47,
};

// A paid+HELD, accepted TCG deal sale. The house seller has NO phone — proving
// booking uses the SUPPLIER's phone, not the seller's. No pickup* columns on a
// deal listing (the whole point — origin comes from the supplier).
const DEAL_TX = {
  id: 'TXD1',
  paymentStatus: 'HELD',
  shippingMethod: 'TCG',
  shippingServiceCode: 'ECO',
  listingId: 'L-DEAL',
  quantity: 1,
  listingPrice: 199900,
  pudoPickupLockerId: null,
  deliveryAddress: DELIVERY,
  listing: {
    isDealListing: true,
    title: 'Trail Camera 4K',
    weightGrams: 1200,
    lengthCm: 25,
    widthCm: 18,
    heightCm: 12,
  },
  buyer: { firstName: 'Bo', lastName: 'B', username: 'bob', email: 'b@x.co', phone: '0830000000' },
  seller: { firstName: 'Gun', lastName: 'Galore', username: 'gungalore', email: 'ops@x.co', phone: null },
  shippedWith: [],
};

// An ordinary seller TCG sale — pickup* columns on the listing, seller has a
// phone; no deal, no supplier.
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
    isDealListing: false,
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
  buyer: { firstName: 'Bo', lastName: 'B', username: 'bob', email: 'b@x.co', phone: '0830000000' },
  seller: { firstName: 'Jan', lastName: 'P', username: 'janp', email: 's@x.co', phone: '0820000000' },
  shippedWith: [],
};

function makeService(over: { tx?: unknown; supplier?: unknown } = {}) {
  const prisma = {
    transaction: {
      // bookForTransaction reads the tx twice (shipsWithId probe, then full
      // include). A single resolver serves both — the probe just reads
      // shipsWithId (undefined on our fixtures → not a sibling).
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(over.tx ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    deal: {
      findUnique: jest.fn().mockResolvedValue(
        'supplier' in over
          ? { id: 'DEAL1', supplierRef: 'PO-REF-77', supplier: over.supplier }
          : { id: 'DEAL1', supplierRef: 'PO-REF-77', supplier: SUPPLIER },
      ),
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
  const svc = new ShippingService(
    prisma as never,
    notifications as never,
    pudo as never,
    tcg as never,
  );
  return { svc, prisma, pudo, tcg, notifications };
}

describe('DD-F4 bookForTransaction — deal collection origin = SUPPLIER warehouse', () => {
  it('books a TCG deal with the SUPPLIER warehouse as the collection (from) address', async () => {
    const { svc, prisma, tcg, pudo } = makeService({ tx: DEAL_TX });

    const res = await svc.bookForTransaction('TXD1');

    // Collected from the supplier warehouse as a BUSINESS address, not the
    // (phantom) house seller. Province mapped to TCG's long-form name.
    expect(tcg.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.objectContaining({
          streetAddress: '10 Industrial Rd',
          suburb: 'Epping',
          city: 'Cape Town',
          postalCode: '7460',
          province: 'Western Cape',
          type: 'business',
          company: 'Acme Distribution',
        }),
      }),
    );
    // The supplier was resolved via a SEPARATE deal query (never off the tx).
    expect(prisma.deal.findUnique).toHaveBeenCalled();
    // TCG-only for deals — Pudo is never touched.
    expect(pudo.createShipment).not.toHaveBeenCalled();
    expect(res?.trackingReference).toBe('TCG12345');
  });

  it('routes the courier to the buyer delivery address (to), independent of the supplier origin', async () => {
    const { svc, tcg } = makeService({ tx: DEAL_TX });
    await svc.bookForTransaction('TXD1');
    expect(tcg.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.objectContaining({ streetAddress: '1 Buyer St', city: 'Cape Town' }),
      }),
    );
  });

  it('uses the SUPPLIER contact (phone/name) for collection, not the phone-less house seller', async () => {
    const { svc, tcg } = makeService({ tx: DEAL_TX });
    await svc.bookForTransaction('TXD1');
    const arg = (tcg.createShipment as jest.Mock).mock.calls[0][0];
    expect(arg.collectionContact).toEqual(
      expect.objectContaining({ name: 'Wendy Warehouse', mobile: '0210000000' }),
    );
  });

  it('fail-safe: a deal whose supplier has no phone books nothing and alerts an admin', async () => {
    const { svc, tcg, prisma } = makeService({
      tx: DEAL_TX,
      supplier: { ...SUPPLIER, phone: '' },
    });
    const res = await svc.bookForTransaction('TXD1');
    expect(res).toBeNull(); // resolved, not thrown
    expect(tcg.createShipment).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SHIPMENT_BOOKING_FAILED', referenceId: 'TXD1' }),
      }),
    );
    // Claim released so an admin can retry.
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shipmentBookingStartedAt: null } }),
    );
  });
});

describe('DD-F4 bookForTransaction — ordinary sale still collects from the SELLER pickup (unchanged)', () => {
  it('books a non-deal TCG sale with the seller pickup address and never loads a supplier', async () => {
    const { svc, prisma, tcg } = makeService({ tx: SELLER_TX });

    await svc.bookForTransaction('TXS1');

    const arg = (tcg.createShipment as jest.Mock).mock.calls[0][0];
    // Origin = the seller's own pickup* columns…
    expect(arg.from).toEqual(
      expect.objectContaining({
        streetAddress: '5 Seller Ave',
        city: 'Cape Town',
        postalCode: '8005',
        province: 'Western Cape',
      }),
    );
    // …and NOT a supplier business address (no company/business type).
    expect(arg.from.company).toBeUndefined();
    expect(arg.from.type).toBeUndefined();
    // No deal → the supplier lane is never entered.
    expect(prisma.deal.findUnique).not.toHaveBeenCalled();
  });
});
