import { SerperClient } from './serper.client';

describe('SerperClient', () => {
  const originalFetch = global.fetch;
  const KEY = 'test-key-should-never-be-logged';

  beforeAll(() => {
    process.env.SERPER_API_KEY = KEY;
    process.env.SERPER_GL = 'za';
  });
  afterAll(() => {
    global.fetch = originalFetch;
    delete process.env.SERPER_API_KEY;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports configured when the key is present', () => {
    expect(new SerperClient().isConfigured()).toBe(true);
  });

  it('maps organic search results to SA comp candidates', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        organic: [
          { title: 'Jurgens XT120', link: 'https://www.gumtree.co.za/a/1', snippet: 'R62 000' },
          { title: 'bad', link: 'not-a-url' },
        ],
      }),
    }) as unknown as typeof fetch;

    const out = await new SerperClient().search('Jurgens XT120 used');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: 'https://www.gumtree.co.za/a/1', title: 'Jurgens XT120' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-API-KEY']).toBe(KEY);
    expect(JSON.parse(init.body).gl).toBe('za');
  });

  it('maps shopping results and parses ZAR prices', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        shopping: [
          { title: 'Kershaw Blur', price: 'R 1 419,96', source: 'Camp & Climb', link: 'https://campandclimb.co.za/x' },
          { title: 'no price', link: 'https://x.co.za/y' },
        ],
      }),
    }) as unknown as typeof fetch;

    const out = await new SerperClient().shopping('Kershaw Blur');
    expect(out).toHaveLength(1);
    expect(out[0].priceZar).toBe(1420);
    expect(out[0].sourceSite).toBe('Camp & Climb');
  });

  it('returns an empty array on a hard failure without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }) as unknown as typeof fetch;
    const out = await new SerperClient().search('anything');
    expect(out).toEqual([]);
  });
});
