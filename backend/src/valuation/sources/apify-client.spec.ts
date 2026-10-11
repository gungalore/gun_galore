import { ApifyClient } from './apify-client';

describe('ApifyClient', () => {
  const originalFetch = global.fetch;
  const originalFlag = process.env.VALUATION_APIFY_ENABLED;
  const originalToken = process.env.APIFY_TOKEN;
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.VALUATION_APIFY_ENABLED = originalFlag;
    process.env.APIFY_TOKEN = originalToken;
  });

  it('is inert when disabled or unconfigured', async () => {
    process.env.VALUATION_APIFY_ENABLED = 'false';
    process.env.APIFY_TOKEN = 'x';
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(new ApifyClient().isConfigured()).toBe(false);
    expect(await new ApifyClient().runActor('some/actor', {})).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('runs an actor and returns its dataset items', async () => {
    process.env.VALUATION_APIFY_ENABLED = 'true';
    process.env.APIFY_TOKEN = 'apify-test-token';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { defaultDatasetId: 'ds1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ title: 'x', price: 100 }] }) as unknown as typeof fetch;

    const items = await new ApifyClient().runActor('apify/website-content-crawler', { startUrls: [] });
    expect(items).toEqual([{ title: 'x', price: 100 }]);
    const [, runInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(runInit.headers.Authorization).toBe('Bearer apify-test-token');
  });

  it('returns nothing when the run call fails', async () => {
    process.env.VALUATION_APIFY_ENABLED = 'true';
    process.env.APIFY_TOKEN = 'apify-test-token';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await new ApifyClient().runActor('some/actor', {})).toEqual([]);
  });
});
