// Bob Go is the ONLY courier rail (Pudo and The Courier Guy were retired).
// This file pins the /shipments booking contract: what goes on the wire, and
// what callers may read back from the response.

import { BobGoService } from './bobgo.service';

function mockFetchOnce(status: number, json: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(json),
  });
}

const ADDRESS = {
  streetAddress: '1 Main Road',
  suburb: 'Durbanville',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '7550',
};

const CONTACT = { name: 'jan', email: 's@x.co', mobile: '0820000000' };

describe('BobGoService.createShipment', () => {
  let svc: BobGoService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BOBGO_API_KEY = 'test-key';
    process.env.BOBGO_BASE_URL = 'https://api.sandbox.bobgo.co.za/v2';
    global.fetch = jest.fn();
    svc = new BobGoService();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the shipment body and parses tracking + submission', async () => {
    mockFetchOnce(201, {
      id: 16623,
      tracking_reference: 'UASD7R7R',
      submission_status: 'submitted',
    });

    const res = await svc.createShipment({
      collection: ADDRESS,
      delivery: ADDRESS,
      collectionContact: CONTACT,
      deliveryContact: { name: 'buyer', mobile: '0830000000' },
      parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
      serviceCode: 'bobgo_3082_34_0',
      providerSlug: 'sandbox',
      serviceLevelCode: 'ECO',
      declaredValueCents: 150000,
      customerReference: 'TX9',
    });

    expect(res.shipmentId).toBe(16623);
    expect(res.trackingReference).toBe('UASD7R7R');
    expect(res.submission).toBe('SUBMITTED');
    expect(res.rawSubmissionStatus).toBe('submitted');

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.sandbox.bobgo.co.za/v2/shipments');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    // Contacts are FLAT scalars on this endpoint, not the nested
    // {name, mobile_number} objects /rates-at-checkout accepts.
    expect(body.collection_contact_name).toBe('jan');
    expect(body.collection_contact_mobile_number).toBe('0820000000');
    expect(body.delivery_contact_email).toBe(''); // blank email tolerated
    // The full rate key is replayed, not inferred.
    expect(body.service_code).toBe('bobgo_3082_34_0');
    expect(body.provider_slug).toBe('sandbox');
    expect(body.service_level_code).toBe('ECO');
    // R1,500 declared — NOT 150000.
    expect(body.declared_value).toBe(1500);
    expect(body.customer_reference).toBe('TX9');
  });

  it('sends the seller pickup date/window and selected Store Pickup point', async () => {
    mockFetchOnce(201, {
      id: 16624,
      tracking_reference: 'UASPARGO1',
      submission_status: 'submitted',
    });
    await svc.createShipment({
      collection: ADDRESS,
      delivery: ADDRESS,
      collectionContact: CONTACT,
      deliveryContact: { name: 'buyer', mobile: '0830000000' },
      parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
      serviceCode: 'bobgo_PP_3084_104_545_1',
      providerSlug: 'pargo',
      serviceLevelCode: 'BOXL-S',
      declaredValueCents: 150000,
      collectionMinDate: '2026-09-28T08:00:00+02:00',
      collectionAfter: '11:00:00',
      collectionBefore: '14:00:00',
      pickupPointLocationId: 545,
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.collection_min_date).toBe('2026-09-28T08:00:00+02:00');
    expect(body.collection_after).toBe('11:00:00');
    expect(body.collection_before).toBe('14:00:00');
    expect(body.delivery_pickup_point_location_id).toBe(545);
    expect(body.provider_slug).toBe('pargo');
  });

  it('classifies a refusal as FAILED even though the carrier answered 201', async () => {
    // The sandbox answers 201 and then refuses the shipment. A resolved
    // promise is NOT a booking.
    mockFetchOnce(201, {
      id: 16623,
      tracking_reference: 'UASD7R7R',
      submission_status: 'no-rates',
      failed_reason: 'No valid rates received from Demo Couriers',
    });

    const res = await svc.createShipment({
      collection: ADDRESS,
      delivery: ADDRESS,
      collectionContact: CONTACT,
      deliveryContact: { name: 'buyer', mobile: '0830000000' },
      parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
      serviceCode: 'bobgo_3082_34_0',
      providerSlug: 'sandbox',
      serviceLevelCode: 'ECO',
      declaredValueCents: 150000,
    });

    expect(res.submission).toBe('FAILED');
    expect(res.failedReason).toBe('No valid rates received from Demo Couriers');
  });

  it('throws on a non-ok carrier response (does NOT silently succeed)', async () => {
    mockFetchOnce(422, { message: 'zero_balance' });
    await expect(
      svc.createShipment({
        collection: ADDRESS,
        delivery: ADDRESS,
        collectionContact: CONTACT,
        deliveryContact: { name: 'buyer', mobile: '0830000000' },
        parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
        serviceCode: 'bobgo_3082_34_0',
        providerSlug: 'sandbox',
        serviceLevelCode: 'ECO',
        declaredValueCents: 150000,
      }),
    ).rejects.toThrow(/Bob Go POST \/shipments 422/);
  });

  it('surfaces an outage rather than returning a half-booked result', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as never;
    await expect(
      svc.createShipment({
        collection: ADDRESS,
        delivery: ADDRESS,
        collectionContact: CONTACT,
        deliveryContact: { name: 'buyer', mobile: '0830000000' },
        parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
        serviceCode: 'bobgo_3082_34_0',
        providerSlug: 'sandbox',
        serviceLevelCode: 'ECO',
        declaredValueCents: 150000,
      }),
    ).rejects.toThrow(/unreachable/);
  });
});
