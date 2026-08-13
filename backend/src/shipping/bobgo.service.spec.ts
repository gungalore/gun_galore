import {
  BobGoService,
  classifySubmission,
  dedupeLocations,
  haversineKm,
  toWholeRand,
} from './bobgo.service';
import { BobGoLocation } from './bobgo.types';

// Response fragments below are trimmed copies of what the Bob Go sandbox
// actually returned on 2026-08-13, not invented fixtures.

const DOOR_RATE = {
  id: 3082,
  service_code: 'bobgo_3082_34_0',
  service_name: 'Standard shipping',
  service_level_code: 'ECO',
  provider_slug: 'demo',
  type: 'door',
  base_rate: 114.95,
  total_price: 114.95,
  currency: 'ZAR',
  surcharges: [],
  liability_cover: { price: 0 },
};

const PICKUP_RATE = {
  id: 3084,
  service_code: 'bobgo_PP_3084_104_545_1',
  service_name: 'Bob Box Locker – 44 on Stanley (approx. 0.1 km)',
  service_level_code: 'BOXM-M',
  provider_slug: 'demo',
  type: 'pickup-point',
  base_rate: 64.43,
  total_price: 64.43,
  currency: 'ZAR',
  // NOTE: null, not [] — the door rate spells "no surcharges" the other way.
  surcharges: null,
  liability_cover: { price: 0 },
  pickup_point_location_id: 545,
  pickup_point_location_distance: 0.05,
};

function mockFetch(payload: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

describe('classifySubmission', () => {
  it('treats the sandbox no-rates refusal as FAILED', () => {
    expect(
      classifySubmission('no-rates', 'No valid rates received from Demo Couriers'),
    ).toBe('FAILED');
  });

  it('lets a failure reason override an otherwise healthy status', () => {
    // This is the exact trap the sandbox set: a success-shaped response
    // carrying a refusal.
    expect(classifySubmission('submitted', 'No valid rates received')).toBe(
      'FAILED',
    );
  });

  it('does NOT treat "completed" as booked', () => {
    // app_status was "completed" on a shipment no courier accepted.
    expect(classifySubmission('completed')).toBe('PENDING');
    expect(classifySubmission('complete')).toBe('PENDING');
  });

  it('fails closed on any status it does not recognise', () => {
    for (const s of ['', 'weird-new-status', 'processing', 'queued', 'awaiting']) {
      expect(classifySubmission(s)).toBe('PENDING');
    }
  });

  it('recognises only unambiguous success tokens', () => {
    for (const s of ['submitted', 'SUBMITTED', ' Accepted ', 'success']) {
      expect(classifySubmission(s)).toBe('SUBMITTED');
    }
  });

  it('normalises separators', () => {
    expect(classifySubmission('no_rates')).toBe('FAILED');
    expect(classifySubmission('no rates')).toBe('FAILED');
  });
});

describe('BobGoService.getRates', () => {
  const svc = new BobGoService();
  const originalFetch = global.fetch;
  const originalKey = process.env.BOBGO_API_KEY;

  beforeEach(() => {
    process.env.BOBGO_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BOBGO_API_KEY;
    else process.env.BOBGO_API_KEY = originalKey;
  });

  const input = {
    collection: {
      streetAddress: '1 Main Road',
      suburb: 'Durbanville',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '7550',
    },
    delivery: {
      streetAddress: '44 Stanley Avenue',
      suburb: 'Milpark',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2092',
    },
    parcels: [{ lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 2.5 }],
    declaredValueCents: 150000,
  };

  it('returns door and pickup-point rates from one call', async () => {
    global.fetch = mockFetch({ rates: [DOOR_RATE, PICKUP_RATE] }) as any;
    const quote = await svc.getRates(input);

    expect(quote.rates).toHaveLength(2);
    expect(quote.rates.map((r) => r.type)).toEqual(['door', 'pickup-point']);
    expect(quote.rates[1].pickupPointLocationId).toBe(545);
    expect(quote.rates[1].pickupPointDistanceKm).toBeCloseTo(0.05);
  });

  it('handles surcharges being null as well as empty', async () => {
    global.fetch = mockFetch({ rates: [DOOR_RATE, PICKUP_RATE] }) as any;
    const quote = await svc.getRates(input);
    expect(quote.rates[0].surchargeTotal).toBe(0);
    expect(quote.rates[1].surchargeTotal).toBe(0);
  });

  it('never claims pricing is verified', async () => {
    // Guards the caveat in the type: no sandbox quote has yet proven that
    // total_price includes surcharges, so this must stay false until one does.
    global.fetch = mockFetch({ rates: [DOOR_RATE] }) as any;
    expect((await svc.getRates(input)).pricingVerified).toBe(false);
  });

  it('drops a rate with no service_code rather than offering an unbookable price', async () => {
    global.fetch = mockFetch({
      rates: [DOOR_RATE, { ...PICKUP_RATE, service_code: undefined }],
    }) as any;
    const quote = await svc.getRates(input);
    expect(quote.rates).toHaveLength(1);
    expect(quote.rates[0].serviceCode).toBe('bobgo_3082_34_0');
  });

  it('sends items[] — the API 400s without it', async () => {
    const f = mockFetch({ rates: [] });
    global.fetch = f as any;
    await svc.getRates(input);
    const body = JSON.parse((f.mock.calls[0][1] as any).body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.parcels[0].submitted_weight_kg).toBe(2.5);
    expect(body.collection_address.zone).toBe('Western Cape');
    expect(body.collection_address.code).toBe('7550');
    // R1,500 declared — NOT 150000. Sending cents would declare R150,000.
    expect(body.declared_value).toBe(1500);
    expect(body.items[0].price).toBe(1500);
  });

  it('surfaces an outage instead of returning an empty rate list', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as any;
    await expect(svc.getRates(input)).rejects.toThrow(/unreachable/);
  });

  it('is inert without an API key', async () => {
    delete process.env.BOBGO_API_KEY;
    expect(svc.isConfigured).toBe(false);
    await expect(svc.getRates(input)).rejects.toThrow(/not configured/);
  });
});

describe('BobGoService.getUsableLocations', () => {
  const svc = new BobGoService();
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BOBGO_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('excludes lockers with no compartment for the parcel', async () => {
    global.fetch = mockFetch({
      locations: [
        { id: 1, name: 'Has room', latitude: -26.18, longitude: 28.01, active: true, compartment_errors: [] },
        { id: 2, name: 'Full', latitude: -26.19, longitude: 28.02, active: true, compartment_errors: ['no_available_compartments'] },
        { id: 3, name: 'Closed', latitude: -26.2, longitude: 28.03, active: false, compartment_errors: [] },
      ],
    }) as any;

    const usable = await svc.getUsableLocations({ lat: -26.18, lng: 28.01 });
    expect(usable.map((l) => l.id)).toEqual([1]);
  });

  it('sorts by distance from the buyer', async () => {
    global.fetch = mockFetch({
      locations: [
        { id: 91, name: 'Far', latitude: -26.5, longitude: 28.4, active: true, compartment_errors: [] },
        { id: 92, name: 'Near', latitude: -26.181, longitude: 28.011, active: true, compartment_errors: [] },
      ],
    }) as any;
    const out = await svc.getLocations({ lat: -26.18, lng: 28.01 });
    expect(out[0].name).toBe('Near');
    expect(out[0].distanceKm!).toBeLessThan(out[1].distanceKm!);
  });
});

describe('BobGoService.getShipment', () => {
  const svc = new BobGoService();
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BOBGO_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('never returns a different shipment when the id is absent', async () => {
    // The list endpoint may ignore an unsupported ?id= filter and return the
    // whole account. Resolving a PENDING order against an unrelated shipment
    // would mark it booked on the strength of somebody else's parcel.
    global.fetch = mockFetch({
      shipments: [
        { id: 111, submission_status: 'submitted', tracking_reference: 'AAA' },
        { id: 222, submission_status: 'submitted', tracking_reference: 'BBB' },
      ],
    }) as any;
    await expect(svc.getShipment(16623)).rejects.toThrow(/not found/);
  });

  it('returns the matching shipment when present', async () => {
    global.fetch = mockFetch({
      shipments: [
        { id: 111, submission_status: 'submitted', tracking_reference: 'AAA' },
        {
          id: 16623,
          submission_status: 'no-rates',
          failed_reason: 'No valid rates received from Demo Couriers',
          tracking_reference: 'UASD7R7R',
        },
      ],
    }) as any;
    const s = await svc.getShipment(16623);
    expect(s.trackingReference).toBe('UASD7R7R');
    expect(s.submission).toBe('FAILED');
  });
});

describe('dedupeLocations', () => {
  const loc = (over: Partial<BobGoLocation>): BobGoLocation => ({
    id: 545,
    name: '44 on Stanley',
    lat: -26.18,
    lng: 28.01,
    type: 'locker',
    address: '44 Stanley Ave',
    active: true,
    compartmentErrors: [],
    ...over,
  });

  it('collapses the duplicate the sandbox actually returns', () => {
    // /locations returned locker #545 twice in one response.
    const out = dedupeLocations([
      loc({ compartmentErrors: ['no_available_compartments'] }),
      loc({ compartmentErrors: ['no_available_compartments'] }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps the usable duplicate over the unusable one', () => {
    const out = dedupeLocations([
      loc({ compartmentErrors: ['no_available_compartments'] }),
      loc({ compartmentErrors: [] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].compartmentErrors).toEqual([]);
  });

  it('leaves distinct locations alone', () => {
    const out = dedupeLocations([loc({ id: 1 }), loc({ id: 2 })]);
    expect(out.map((l) => l.id)).toEqual([1, 2]);
  });

  it('never merges locations on an untrustworthy id', () => {
    // Number(undefined) is NaN, and Map treats every NaN as one key.
    const out = dedupeLocations([
      loc({ id: NaN, name: 'Alpha' }),
      loc({ id: NaN, name: 'Bravo' }),
      loc({ id: 0, name: 'Charlie' }),
    ]);
    expect(out.map((l) => l.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});

describe('toWholeRand', () => {
  it('converts cents to whole rand the way TcgService does', () => {
    expect(toWholeRand(150000)).toBe(1500);
    expect(toWholeRand(11495)).toBe(115);
  });

  it('clamps negatives to zero', () => {
    expect(toWholeRand(-500)).toBe(0);
  });
});

describe('haversineKm', () => {
  it('measures Cape Town to Johannesburg at roughly 1265 km', () => {
    const d = haversineKm(-33.9249, 18.4241, -26.2041, 28.0473);
    expect(d).toBeGreaterThan(1240);
    expect(d).toBeLessThan(1290);
  });

  it('is zero for the same point', () => {
    expect(haversineKm(-26.2, 28.04, -26.2, 28.04)).toBe(0);
  });
});

describe('BobGoService.getTracking', () => {
  const svc = new BobGoService();
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.BOBGO_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Shape copied from an ACCEPTED sandbox shipment (16625, 2026-08-13).
  const LIVE = {
    tracking_reference: 'UASS9DLM',
    status: 'pending-collection',
    status_friendly: 'Pending collection',
    courier_name: 'Sandbox Couriers',
    has_ready_for_pickup_status: false,
    shipment_movement_events: {
      collected_time: '',
      in_transit_time: '',
      out_for_delivery_time: '',
      ready_for_pickup_time: '',
      delivered_time: '',
    },
    checkpoints: [],
  };

  it('reads the _time-suffixed movement keys', async () => {
    global.fetch = mockFetch({
      ...LIVE,
      shipment_movement_events: {
        ...LIVE.shipment_movement_events,
        collected_time: '2026-08-13T09:00:00Z',
      },
    }) as any;
    const t = await svc.getTracking('UASS9DLM');
    expect(t?.collectedTime).toBe('2026-08-13T09:00:00Z');
  });

  it('treats an empty-string timestamp as "has not happened"', async () => {
    // Bob Go sends "" not null for unset events; passing it through would make
    // a truthiness check read as collected-but-blank.
    global.fetch = mockFetch(LIVE) as any;
    const t = await svc.getTracking('UASS9DLM');
    expect(t?.collectedTime).toBeUndefined();
    expect(t?.deliveredTime).toBeUndefined();
  });

  it('surfaces the friendly status for display', async () => {
    global.fetch = mockFetch(LIVE) as any;
    const t = await svc.getTracking('UASS9DLM');
    expect(t?.status).toBe('pending-collection');
    expect(t?.statusFriendly).toBe('Pending collection');
    expect(t?.courierName).toBe('Sandbox Couriers');
    expect(t?.readyForPickup).toBe(false);
  });
});
