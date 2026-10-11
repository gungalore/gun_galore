import { ShopifyAdapter } from './shopify.adapter';
import { SourceQuery } from '../types';

const query: SourceQuery = {
  categorySlug: 'camping-outdoor',
  make: 'MSR',
  model: 'Hubba Hubba NX2',
  keySpec: null,
  conditionBand: 'GOOD',
  limit: 10,
};

function jsonResponse(body: unknown, contentType = 'application/json') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    json: async () => body,
  };
}

describe('ShopifyAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps relevant products to new-price anchor hits', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        products: [
          {
            id: 1,
            title: 'MSR Hubba Hubba NX2 Tent',
            handle: 'hubba-nx2',
            vendor: 'MSR',
            product_type: 'Tents',
            published_at: '2026-01-02T09:00:00Z',
            variants: [{ price: '4200.00', available: true }],
          },
          { id: 2, title: 'Unrelated Camp Chair', handle: 'chair', vendor: 'Other', variants: [{ price: '300' }] },
        ],
      }),
    ) as unknown as typeof fetch;

    const hits = await new ShopifyAdapter().search('shop.example', query);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      refId: 'hubba-nx2',
      domain: 'shop.example',
      brand: 'MSR',
      priceZar: 4200,
      isNew: true,
      condition: 'NEW',
      listedDate: '2026-01-02',
    });
  });

  it('rejects a 200 that is not JSON (SPA shell)', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse('<html></html>', 'text/html')) as unknown as typeof fetch;
    const hits = await new ShopifyAdapter().search('shop.example', query);
    expect(hits).toEqual([]);
  });
});
