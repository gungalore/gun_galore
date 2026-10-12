import { ScrapewiseAdapter, priceFromText } from './scrapewise.adapter';
import { SourceQuery } from '../types';

jest.mock('../sitemap-jsonld', () => {
  const actual = jest.requireActual('../sitemap-jsonld');
  return { ...actual, collectSitemapUrls: jest.fn() };
});
import { collectSitemapUrls } from '../sitemap-jsonld';

const PRODUCT =
  '<html><head><script type="application/ld+json">{"@type":"Product","name":"Vortex Viper PST 2.5-10x44","offers":{"price":"12999"}}</script></head></html>';
const query: SourceQuery = { categorySlug: 'optics', make: 'Vortex', model: 'Viper PST', keySpec: null, conditionBand: 'GOOD', limit: 10 };

describe('priceFromText', () => {
  it('reads the first ZAR amount from visible text', () => {
    expect(priceFromText('<div>R 8,009.00 was R9,000</div>')).toBe(8009);
    expect(priceFromText('<div>R12999</div>')).toBe(12999);
    expect(priceFromText('<div>no price</div>')).toBeNull();
  });
});

describe('ScrapewiseAdapter', () => {
  beforeEach(() => (collectSitemapUrls as jest.Mock).mockReset());

  it('renders matched product pages and reads the price', async () => {
    (collectSitemapUrls as jest.Mock).mockResolvedValue(['https://shop.co.za/vortex-viper-pst.html']);
    const client = { isConfigured: () => true, fetchPage: jest.fn().mockResolvedValue(PRODUCT) };
    const hits = await new ScrapewiseAdapter(client as never).search('shop.co.za', query);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Vortex Viper PST 2.5-10x44', priceZar: 12999, domain: 'shop.co.za' });
  });

  it('is inert without a configured key', async () => {
    const client = { isConfigured: () => false, fetchPage: jest.fn() };
    expect(await new ScrapewiseAdapter(client as never).search('shop.co.za', query)).toEqual([]);
    expect(collectSitemapUrls).not.toHaveBeenCalled();
  });
});
