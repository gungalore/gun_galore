import { MagentoAdapter, parseMagentoPrice, parseTitle } from './magento.adapter';
import { SourceQuery } from '../types';

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return { categorySlug: 'reloading-equipment', make: 'Redding', model: 'Big Boss', keySpec: null, conditionBand: 'GOOD', limit: 10, ...over };
}

const HOME =
  '<a href="https://www.futurama.co.za/armoury/">Armoury</a>' +
  '<a href="https://www.futurama.co.za/optics/">Optics</a>' +
  '<a href="https://www.futurama.co.za/customer/account/">Account</a>';

const CATEGORY =
  '<a href="https://www.futurama.co.za/redding-big-boss-ii-reloading-press-pro-pak">Redding Big Boss II</a>' +
  '<a href="https://www.futurama.co.za/bushnell-ak-optics-red-dot">Bushnell</a>';

const PRODUCT =
  '<html><head><meta property="product:price:amount" content="10359"/>' +
  '<meta property="product:price:currency" content="ZAR"/>' +
  '<meta itemprop="price" content="10359" /></head><body><h1>Redding Big Boss II Reloading Press Pro Pak</h1></body></html>';

describe('Magento parsers', () => {
  it('reads the price from product:price:amount', () => {
    expect(parseMagentoPrice(PRODUCT)).toBe(10359);
  });
  it('falls back to data-price-amount', () => {
    expect(parseMagentoPrice('<span data-price-amount="4379"></span>')).toBe(4379);
  });
  it('reads the h1 title', () => {
    expect(parseTitle(PRODUCT)).toBe('Redding Big Boss II Reloading Press Pro Pak');
  });
});

describe('MagentoAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('crawls categories, matches a product slug and reads the price', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u === 'https://futurama.co.za/' || u === 'https://www.futurama.co.za/') return { ok: true, headers: { get: () => 'html' }, text: async () => HOME };
      if (u.endsWith('/armoury/') || u.endsWith('/optics/')) return { ok: true, headers: { get: () => 'html' }, text: async () => CATEGORY };
      if (u.includes('redding-big-boss-ii')) return { ok: true, headers: { get: () => 'html' }, text: async () => PRODUCT };
      return { ok: false, text: async () => '' };
    }) as unknown as typeof fetch;

    const hits = await new MagentoAdapter().search('futurama.co.za', q());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Redding Big Boss II Reloading Press Pro Pak', priceZar: 10359, domain: 'futurama.co.za', isNew: true });
  });
});
