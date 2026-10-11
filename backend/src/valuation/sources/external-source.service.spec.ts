import { ExternalSourceService } from './external-source.service';
import { SourceAdapter } from './types';

function build(rows: unknown[], shopifySearch = jest.fn()) {
  const prisma = {
    valuationSource: {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  const shopify = { platform: 'SHOPIFY', search: shopifySearch } as unknown as SourceAdapter;
  const woo = { platform: 'WOO', search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const gunAfrica = { platform: 'MARKETPLACE', domains: ['gunafrica.co.za'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const jaracal = { platform: 'MARKETPLACE', domains: ['jaracal.com'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const apify = { platform: 'MARKETPLACE', domains: ['gumtree.co.za', 'facebook.com'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const ow = { platform: 'SITEMAP_HTML', domains: ['outdoorwarehouse.co.za'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const magento = { platform: 'MAGENTO', domains: ['futurama.co.za'], search: jest.fn().mockResolvedValue([]) } as unknown as SourceAdapter;
  const jevMatch = { mode: () => 'off', judge: jest.fn(async (_i: unknown, h: unknown[]) => h) };
  const service = new ExternalSourceService(prisma, shopify as any, woo as any, gunAfrica as any, jaracal as any, apify as any, ow as any, magento as any, jevMatch as any);
  return { service, prisma, shopifySearch };
}

const item = { make: 'MSR', model: 'Hubba Hubba NX2', keySpec: null };

describe('ExternalSourceService', () => {
  const original = process.env.VALUATION_EXTERNAL_ENABLED;
  const originalMode = process.env.VALUATION_EXTERNAL_MODE;
  afterEach(() => {
    process.env.VALUATION_EXTERNAL_ENABLED = original;
    if (originalMode === undefined) delete process.env.VALUATION_EXTERNAL_MODE;
    else process.env.VALUATION_EXTERNAL_MODE = originalMode;
  });

  it('resolves the lane mode off | shadow | live', () => {
    const { service } = build([]);
    process.env.VALUATION_EXTERNAL_ENABLED = 'false';
    delete process.env.VALUATION_EXTERNAL_MODE;
    expect(service.mode()).toBe('off');
    process.env.VALUATION_EXTERNAL_MODE = 'shadow';
    expect(service.mode()).toBe('shadow');
    process.env.VALUATION_EXTERNAL_MODE = 'live';
    expect(service.mode()).toBe('live');
    delete process.env.VALUATION_EXTERNAL_MODE;
    process.env.VALUATION_EXTERNAL_ENABLED = 'true';
    expect(service.mode()).toBe('live');
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

  it('records per-source hit counters (learning loop)', async () => {
    process.env.VALUATION_EXTERNAL_ENABLED = 'true';
    const search = jest.fn().mockResolvedValue([
      { refId: 'h1', title: 'MSR Hubba Hubba NX2', priceZar: 4200, domain: 'shop.example', brand: 'MSR', model: 'Hubba Hubba NX2', isNew: true },
      { refId: 'h2', title: 'MSR Hubba NX', priceZar: 3000, domain: 'shop.example', brand: 'MSR', model: 'Hubba NX', isNew: true },
    ]);
    const { service, prisma } = build(
      [{ domain: 'shop.example', platform: 'SHOPIFY', roles: ['ANCHOR'], categories: ['*'] }],
      search,
    );
    await service.collect('camping-outdoor', item, 'GOOD');
    await new Promise((r) => setTimeout(r, 0));
    expect(prisma.valuationSource.updateMany).toHaveBeenCalledWith({
      where: { domain: 'shop.example' },
      data: { totalHits: { increment: 2 }, pricedHits: { increment: 2 }, lastCheckAt: expect.any(Date) },
    });
  });
});
