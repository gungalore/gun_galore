// PudoService transitively imports SearchService → ESM-only meilisearch.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { PudoService } from './pudo.service';

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
      // Pudo is booked-or-throw, so returning at all IS the confirmation.
      provider: 'PUDO',
      submission: 'SUBMITTED',
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
