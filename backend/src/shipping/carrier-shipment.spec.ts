// PudoService transitively imports SearchService → ESM-only meilisearch.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { PudoService } from './pudo.service';
import { TcgService } from './tcg.service';

function mockFetchOnce(status: number, json: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

describe('PudoService.createShipment (L2L)', () => {
  let svc: PudoService;
  beforeEach(() => {
    process.env.PUDO_API_KEY = 'pk_test|sk_test';
    process.env.PUDO_BASE_URL = 'https://api-pudo.co.za';
    global.fetch = jest.fn();
    svc = new PudoService({} as never, {} as never);
  });

  it('posts the L2L body and parses tracking + pin from the response', async () => {
    mockFetchOnce(200, {
      id: 297,
      custom_tracking_reference: 'PUDOD000570',
      pincode: '270089',
      status: 'collection-assigned',
    });

    const res = await svc.createShipment({
      serviceCode: 'L2LXS - ECO',
      toLockerId: 'CG929',
      collectionContact: { name: 'jan', email: 's@x.co', mobile: '0820000000' },
      deliveryContact: { name: 'buyer', mobile: '0830000000' },
    });

    expect(res).toEqual({
      carrier: 'PUDO',
      shipmentId: '297',
      trackingReference: 'PUDOD000570',
      pin: '270089',
      status: 'collection-assigned',
    });

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api-pudo.co.za/api/v1/shipments');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.collection_address).toEqual({ type: 'locker' }); // any-locker drop
    expect(body.delivery_address).toEqual({ terminal_id: 'CG929' });
    expect(body.service_level_code).toBe('L2LXS - ECO');
    expect(body.collection_contact.mobile_number).toBe('0820000000');
    expect(body.delivery_contact.email).toBe(''); // blank email tolerated
  });

  it('throws on a non-ok carrier response (does NOT silently succeed)', async () => {
    mockFetchOnce(422, { message: 'zero_balance' });
    await expect(
      svc.createShipment({
        serviceCode: 'L2LXS - ECO',
        toLockerId: 'CG929',
        collectionContact: { name: 'jan', mobile: '0820000000' },
        deliveryContact: { name: 'buyer', mobile: '0830000000' },
      }),
    ).rejects.toThrow(/Pudo shipment create 422/);
  });

  it('throws if the response is missing id/tracking (never returns a half-booked result)', async () => {
    mockFetchOnce(200, { status: 'ok' });
    await expect(
      svc.createShipment({
        serviceCode: 'L2LXS - ECO',
        toLockerId: 'CG929',
        collectionContact: { name: 'jan', mobile: '0820000000' },
        deliveryContact: { name: 'buyer', mobile: '0830000000' },
      }),
    ).rejects.toThrow(/missing id\/tracking/);
  });

  it('waybillUrl embeds the shipment id (key carried server-side only)', () => {
    expect(svc.waybillUrl('297')).toContain('/generate/waybill/297?api_key=');
  });
});

describe('TcgService.createShipment (D2D)', () => {
  let svc: TcgService;
  const addr = {
    streetAddress: '1 Main',
    suburb: 'X',
    city: 'Cape Town',
    province: 'Western Cape',
    postalCode: '8001',
  };
  beforeEach(() => {
    process.env.TCG_API_KEY = 'tcg_test';
    delete process.env.TCG_BASE_URL;
    global.fetch = jest.fn();
    svc = new TcgService();
  });

  it('posts the D2D body and parses tracking (no PIN for door-to-door)', async () => {
    mockFetchOnce(200, {
      id: 8881,
      short_tracking_reference: 'TCG12345',
      status: 'pending-collection',
    });

    const res = await svc.createShipment({
      serviceCode: 'ECO',
      from: addr,
      to: { ...addr, city: 'Joburg', province: 'Gauteng', postalCode: '2000' },
      parcel: { weightKg: 2, lengthCm: 40, widthCm: 30, heightCm: 8 },
      declaredValueCents: 150000,
      collectionContact: { name: 'jan', mobile: '0820000000' },
      deliveryContact: { name: 'buyer', mobile: '0830000000' },
    });

    expect(res).toEqual({
      carrier: 'TCG',
      shipmentId: '8881',
      trackingReference: 'TCG12345',
      status: 'pending-collection',
    });
    expect(res.pin).toBeUndefined();

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.portal.thecourierguy.co.za/shipments');
    const body = JSON.parse(opts.body);
    expect(body.service_level_code).toBe('ECO');
    expect(body.declared_value).toBe(1500); // cents → rand
    expect(body.parcels[0].submitted_weight_kg).toBe(2);
    expect(body.collection_address.city).toBe('Cape Town');
    expect(body.delivery_address.city).toBe('Joburg');
  });

  it('throws on a non-ok carrier response', async () => {
    mockFetchOnce(400, { message: 'bad route' });
    await expect(
      svc.createShipment({
        serviceCode: 'ECO',
        from: addr,
        to: addr,
        parcel: { weightKg: 2, lengthCm: 40, widthCm: 30, heightCm: 8 },
        declaredValueCents: 1000,
        collectionContact: { name: 'jan', mobile: '0820000000' },
        deliveryContact: { name: 'buyer', mobile: '0830000000' },
      }),
    ).rejects.toThrow(/TCG shipment create 400/);
  });
});
