import { HtmlCatalogAdapter, parseHtmlName, parseHtmlPrice } from './html-catalog.adapter';
import { SourceQuery } from '../types';

jest.mock('../http', () => ({ getText: jest.fn() }));
import { getText } from '../http';

const SITEMAP =
  '<?xml version="1.0"?><urlset><url><loc>https://shop.co.za/vortex-viper-pst-2-5-10x44.html</loc></url></urlset>';
const PRODUCT =
  '<html><head><script type="application/ld+json">{"@type":"Product","name":"Vortex Viper PST 2.5-10x44","brand":{"name":"Vortex"},"offers":{"price":"12999","availability":"https://schema.org/InStock"}}</script></head><body><h1>Vortex Viper PST</h1></body></html>';

const query: SourceQuery = { categorySlug: 'optics', make: 'Vortex', model: 'Viper PST', keySpec: null, conditionBand: 'GOOD', limit: 10 };

describe('parseHtmlPrice', () => {
  it('reads JSON-LD, product:price meta or og:price meta', () => {
    expect(parseHtmlPrice(PRODUCT)).toBe(12999);
    expect(parseHtmlPrice('<meta property="product:price:amount" content="4500">')).toBe(4500);
    expect(parseHtmlPrice('<meta property="og:price:amount" content="2200">')).toBe(2200);
    expect(parseHtmlPrice('<html><body>no price</body></html>')).toBeNull();
  });
});

describe('parseHtmlName', () => {
  it('prefers the JSON-LD name, then the h1', () => {
    expect(parseHtmlName(PRODUCT)).toBe('Vortex Viper PST 2.5-10x44');
    expect(parseHtmlName('<html><body><h1>Just An H1</h1></body></html>')).toBe('Just An H1');
  });
});

describe('HtmlCatalogAdapter', () => {
  beforeEach(() => (getText as jest.Mock).mockReset());

  it('discovers a product via the sitemap and reads its price', async () => {
    (getText as jest.Mock).mockImplementation(async (url: string) => {
      if (url.endsWith('sitemap.xml')) return SITEMAP;
      if (url.includes('vortex-viper')) return PRODUCT;
      return null;
    });
    const hits = await new HtmlCatalogAdapter().search('shop.co.za', query);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Vortex Viper PST 2.5-10x44', priceZar: 12999, domain: 'shop.co.za' });
  });

  it('returns nothing when the slug does not match the query', async () => {
    (getText as jest.Mock).mockImplementation(async (url: string) => (url.endsWith('sitemap.xml') ? SITEMAP : null));
    const hits = await new HtmlCatalogAdapter().search('shop.co.za', { ...query, make: 'Leupold', model: 'VX3' });
    expect(hits).toEqual([]);
  });
});
