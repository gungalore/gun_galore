import { ExternalSourceService } from './external-source.service';
import { SourceAdapter } from './types';

function build(rows: unknown[], shopifySearch = jest.fn()) {
  const prisma = { valuationSource: { findMany: jest.fn().mockResolvedValue(rows) } } as any;
  const shopify = { platform: 'SHOPIFY', search: shopifySearch } as unknown as SourceAdapter;
  const woo = { platform: 'WOO', search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const gunAfrica = { platform: 'MARKETPLACE', domains: ['gunafrica.co.za'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const service = new ExternalSourceService(prisma, shopify as any, woo as any, gunAfrica as any);
  return { service, prisma, shopifySearch };
}

const item = { make: 'MSR', model: 'Hubba Hubba NX2', keySpec: null };

describe('ExternalSourceService', () => {
  const original = process.env.VALUATION_EXTERNAL_ENABLED;
  afterEach(() => {
    process.env.VALUATION_EXTERNAL_ENABLED = original;
  });

  it('is inert when the feature flag is off', async () => {
    process.env.VALUATION_EXTERNAL_ENABLED = 'false';
    const { service, prisma } = build([]);
    expect(await service.collect('camping-outdoor', item, 'GOOD')).toEqual([]);
    expect(prisma.valuationSource.findMany).not.toHaveBeenCalled();
  });

  it('maps enabled adapter hits into comps', async () => {
    process.env.VALUATION_EXTERNAL_ENABLED = 'true';
    const search = jest.fn().mockResolvedValue([
      { refId: 'h1', title: 'MSR Hubba Hubba NX2', priceZar: 4200, domain: 'shop.example', brand: 'MSR', model: 'Hubba Hubba NX2', isNew: true },
    ]);
    const { service } = build(
      [{ domain: 'shop.example', platform: 'SHOPIFY', roles: ['ANCHOR'], categories: ['*'] }],
      search,
    );

    const comps = await service.collect('camping-outdoor', item, 'GOOD');
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ kind: 'RETAIL_ANCHOR', sourceSite: 'shop.example', priceZar: 4200, url: 'src://shop.example/h1' });
  });

  it('tolerates a failing source', async () => {
    process.env.VALUATION_EXTERNAL_ENABLED = 'true';
    const search = jest.fn().mockRejectedValue(new Error('boom'));
    const { service } = build(
      [{ domain: 'shop.example', platform: 'SHOPIFY', roles: ['ANCHOR'], categories: ['*'] }],
      search,
    );
    expect(await service.collect('camping-outdoor', item, 'GOOD')).toEqual([]);
  });

  it('ignores sources not scoped to the category', async () => {
    process.env.VALUATION_EXTERNAL_ENABLED = 'true';
    const { service, shopifySearch } = build([
      { domain: 'shop.example', platform: 'SHOPIFY', roles: ['ANCHOR'], categories: ['knives'] },
    ]);
    expect(await service.collect('camping-outdoor', item, 'GOOD')).toEqual([]);
    expect(shopifySearch).not.toHaveBeenCalled();
  });
});
