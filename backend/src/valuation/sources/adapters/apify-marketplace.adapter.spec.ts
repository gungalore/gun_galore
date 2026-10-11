import { ApifyMarketplaceAdapter, extractRenderedListings } from './apify-marketplace.adapter';
import { ApifyClient } from '../apify-client';
import { SourceQuery } from '../types';

function q(over: Partial<SourceQuery> = {}): SourceQuery {
  return { categorySlug: 'firearms', make: 'Tikka', model: 'T3x', keySpec: null, conditionBand: 'GOOD', limit: 10, ...over };
}

const TEXT =
  'Tikka T3x Lite .308 R12 500 Pietermaritzburg 2 days ago\n' +
  'Tikka T3x Varmint .223 R14,999.00 Durban\n' +
  'Sako 85 .270 R29 000 Johannesburg';

describe('extractRenderedListings', () => {
  it('extracts relevant priced listings (with or without decimals)', () => {
    const hits = extractRenderedListings(TEXT, 'gumtree.co.za', q());
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.priceZar).sort((a, b) => a - b)).toEqual([12500, 14999]);
  });

  it('ignores unrelated titles', () => {
    const hits = extractRenderedListings(TEXT, 'gumtree.co.za', q({ make: null, model: 'Howa 1500' }));
    expect(hits).toEqual([]);
  });
});

describe('ApifyMarketplaceAdapter', () => {
  const originalFlag = process.env.VALUATION_APIFY_ENABLED;
  const originalToken = process.env.APIFY_TOKEN;
  afterEach(() => {
    process.env.VALUATION_APIFY_ENABLED = originalFlag;
    process.env.APIFY_TOKEN = originalToken;
  });

  it('returns nothing when Apify is not configured', async () => {
    process.env.VALUATION_APIFY_ENABLED = 'false';
    const apify = new ApifyClient();
    const adapter = new ApifyMarketplaceAdapter(apify);
    expect(await adapter.search('gumtree.co.za', q())).toEqual([]);
  });

  it('crawls the search URL and parses the rendered text', async () => {
    process.env.VALUATION_APIFY_ENABLED = 'true';
    process.env.APIFY_TOKEN = 'apify-test-token';
    const apify = new ApifyClient();
    jest.spyOn(apify, 'runActor').mockResolvedValue([{ text: TEXT }]);
    const adapter = new ApifyMarketplaceAdapter(apify);
    const hits = await adapter.search('gumtree.co.za', q());
    expect(hits).toHaveLength(2);
    expect(apify.runActor).toHaveBeenCalled();
  });
});
