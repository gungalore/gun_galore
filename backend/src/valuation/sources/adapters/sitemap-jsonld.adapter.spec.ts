import { SitemapJsonLdAdapter } from './sitemap-jsonld.adapter';
import { parseProductJsonLd, parseCustomData } from '../sitemap-jsonld';
import { SourceQuery } from '../types';

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return { categorySlug: 'reloading-equipment', make: 'Redding', model: 'Boss', keySpec: null, conditionBand: 'GOOD', limit: 10, ...over };
}

// A Safari Outdoor (Magento) product page carries a Product JSON-LD block with
// offers.price in ZAR.
const SAFARI_LD =
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",' +
  '"name":"REDDING THE BOSS SINGLE-STAGE RELOADING PRESS","brand":"Redding",' +
  '"offers":{"@type":"Offer","priceCurrency":"ZAR","availability":"https://schema.org/InStock","price":"4399.00"}}' +
  '</script>';

describe('sitemap-jsonld parsers', () => {
  it('reads the Product JSON-LD offer price', () => {
    expect(parseProductJsonLd(SAFARI_LD)).toEqual({
      name: 'REDDING THE BOSS SINGLE-STAGE RELOADING PRESS',
      brand: 'Redding',
      priceZar: 4399,
      available: 'https://schema.org/InStock',
    });
  });
  it('reads the embedded custom-data fallback', () => {
    const html = `:custom-data='{"content_type":"product","content_ids":["1000218"],"value":699,"currency":"ZAR","content_name":"SecureTech Cargo Bar"}'`;
    expect(parseCustomData(html)).toEqual({ priceZar: 699, name: 'SecureTech Cargo Bar' });
  });
});

describe('SitemapJsonLdAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const SITEMAP =
    '<urlset>' +
    '<url><loc>https://safarioutdoor.co.za/shooting/reloading-components/reloading-presses/press-redding-the-boss-press</loc></url>' +
    '<url><loc>https://safarioutdoor.co.za/shooting/optics/riflescopes/vortex-viper-scope</loc></url>' +
    '</urlset>';

  it('matches a product URL by slug and reads its JSON-LD price', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('sitemap.xml')) return { ok: true, headers: { get: () => 'xml' }, text: async () => SITEMAP };
      if (url.includes('press-redding-the-boss')) return { ok: true, headers: { get: () => 'html' }, text: async () => SAFARI_LD };
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch;

    const hits = await new SitemapJsonLdAdapter().search('safarioutdoor.co.za', q());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'REDDING THE BOSS SINGLE-STAGE RELOADING PRESS', priceZar: 4399, brand: 'Redding', isNew: true });
  });

  it('returns nothing when no slug matches', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => 'xml' }, text: async () => SITEMAP }) as unknown as typeof fetch;
    expect(await new SitemapJsonLdAdapter().search('safarioutdoor.co.za', q({ make: null, model: 'Howa 1500' }))).toEqual([]);
  });
});
