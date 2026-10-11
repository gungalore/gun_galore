import {
  OutdoorWarehouseAdapter,
  parseProductJsonLd,
  parseCustomData,
} from './outdoorwarehouse.adapter';
import { SourceQuery } from '../types';

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return { categorySlug: 'camping-outdoor', make: 'MSR', model: 'Hubba Hubba NX 2', keySpec: null, conditionBand: 'GOOD', limit: 10, ...over };
}

const SITEMAP =
  '<urlset>' +
  '<url><loc>https://www.outdoorwarehouse.co.za/product/msr-hubba-hubba-nx-2-tent/</loc></url>' +
  '<url><loc>https://www.outdoorwarehouse.co.za/product/unrelated-chainsaw/</loc></url>' +
  '</urlset>';

const PRODUCT_LD =
  '<html><head><script type="application/ld+json">' +
  '{"@context":"http://schema.org","@type":"Product","name":"MSR Hubba Hubba NX 2 Tent",' +
  '"brand":{"@type":"Brand","name":"MSR"},"offers":{"price":"4999","priceCurrency":"ZAR",' +
  '"availability":"https://schema.org/InStock"}}' +
  '</script></head><body></body></html>';

describe('Outdoor Warehouse parsers', () => {
  it('reads a Product JSON-LD block', () => {
    expect(parseProductJsonLd(PRODUCT_LD)).toEqual({
      name: 'MSR Hubba Hubba NX 2 Tent',
      brand: 'MSR',
      priceZar: 4999,
      available: 'https://schema.org/InStock',
    });
  });
  it('reads the embedded custom-data fallback', () => {
    const html = `:custom-data='{"content_type":"product","content_ids":["1000218"],"value":699,"currency":"ZAR","content_name":"SecureTech Cargo Bar"}'`;
    expect(parseCustomData(html)).toEqual({ priceZar: 699, name: 'SecureTech Cargo Bar' });
  });
});

describe('OutdoorWarehouseAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('matches the sitemap slug and reads the product price', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('sitemap.xml')) return { ok: true, text: async () => SITEMAP };
      if (url.includes('/product/msr-hubba')) return { ok: true, text: async () => PRODUCT_LD };
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch;

    const hits = await new OutdoorWarehouseAdapter().search('outdoorwarehouse.co.za', q());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'MSR Hubba Hubba NX 2 Tent', priceZar: 4999, brand: 'MSR', isNew: true });
  });

  it('returns nothing when no slug matches', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => SITEMAP }) as unknown as typeof fetch;
    const hits = await new OutdoorWarehouseAdapter().search('outdoorwarehouse.co.za', q({ make: null, model: 'Kovea Spider' }));
    expect(hits).toEqual([]);
  });
});
