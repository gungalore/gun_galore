import { WooAdapter } from './woo.adapter';
import { SourceQuery } from '../types';

const query: SourceQuery = {
  categorySlug: 'firearms',
  make: 'Tikka',
  model: 'T3x',
  keySpec: '.308',
  conditionBand: 'GOOD',
  limit: 10,
};

function jsonResponse(body: unknown, contentType = 'application/json') {
  return { ok: true, status: 200, headers: { get: () => contentType }, json: async () => body };
}

describe('WooAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps Store API products to anchor hits with minor-unit price conversion', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 5,
          sku: 'TIK-T3X-308',
          name: 'Tikka T3x Lite .308 Rifle',
          is_in_stock: true,
          prices: { price: '2199900', currency_minor_unit: 2 },
          categories: [{ name: 'Rifles' }],
        },
      ]),
    ) as unknown as typeof fetch;

    const hits = await new WooAdapter().search('woo.example', query);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      refId: 'TIK-T3X-308',
      domain: 'woo.example',
      priceZar: 21999,
      isNew: true,
      available: true,
      productType: 'Rifles',
    });
  });

  it('returns nothing when there are no query terms', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const hits = await new WooAdapter().search('woo.example', { ...query, make: null, model: null, keySpec: null });
    expect(hits).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
