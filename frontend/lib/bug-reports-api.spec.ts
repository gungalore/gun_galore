import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitBugReport } from './bug-reports-api';

describe('submitBugReport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts multipart fields to /bugs/report with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const shot = new Blob(['x'], { type: 'image/png' });
    const result = await submitBugReport(
      {
        category: 'BUY_NOW',
        description: 'Something broke here.',
        url: 'https://alloutdoor.co.za/listings/abc',
        screenshot: shot as unknown as File,
      },
      'tok',
    );

    expect(result).toEqual({ received: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/bugs/report');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
    const form = init.body as FormData;
    expect(form.get('category')).toBe('BUY_NOW');
    expect(form.get('description')).toBe('Something broke here.');
    expect(form.get('url')).toBe('https://alloutdoor.co.za/listings/abc');
    // FormData serialises a Blob to a File (named "blob"); assert the part is
    // present with the right type/size rather than object identity.
    const attached = form.get('screenshot');
    expect(attached).toBeInstanceOf(Blob);
    expect((attached as Blob).type).toBe('image/png');
    expect((attached as Blob).size).toBe(1);
  });

  it('throws the backend message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Choose a valid category.' }),
      }),
    );

    await expect(
      submitBugReport({ category: 'X', description: 'nope' }, null),
    ).rejects.toThrow('Choose a valid category.');
  });
});
