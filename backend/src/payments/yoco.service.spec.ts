import { YocoService } from './yoco.service';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeService(env: Record<string, string | undefined> = {}) {
  process.env = {
    ...originalEnv,
    YOCO_SECRET_KEY: 'sk_test_abc123',
    NODE_ENV: 'test',
    ...env,
  };
  return new YocoService();
}

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('Yoco Checkout API adapter', () => {
  it('is usable with a test key outside production, but never with one in production', () => {
    expect(makeService().isUsable()).toBe(true);
    expect(makeService({ NODE_ENV: 'production' }).isUsable()).toBe(false);
    expect(makeService({ NODE_ENV: 'production' }).isTestKey()).toBe(true);
    // The deliberate production test window the operator opens before go-live.
    expect(
      makeService({
        NODE_ENV: 'production',
        YOCO_ALLOW_TEST_IN_PRODUCTION: 'true',
      }).isUsable(),
    ).toBe(true);
    expect(makeService({ YOCO_SECRET_KEY: '' }).isConfigured()).toBe(false);
    expect(
      makeService({ YOCO_SECRET_KEY: 'sk_live_abc', NODE_ENV: 'production' })
        .isUsable(),
    ).toBe(true);
  });

  it('creates a hosted checkout with our reference, amount and idempotency key', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        id: 'ch_1',
        redirectUrl: 'https://c.yoco.com/checkout/abc',
        status: 'created',
        paymentId: null,
        amount: 29_500,
        processingMode: 'test',
        clientReferenceId: 'MO000123-ABC123',
        metadata: { reference: 'MO000123-ABC123' },
      }),
    );
    global.fetch = fetchMock as never;

    const svc = makeService();
    const checkout = await svc.createCheckout({
      amountZarCents: 29_500,
      reference: 'MO000123-ABC123',
      returnUrl: 'https://alloutdoor.co.za/pack?payment=return',
      metadata: { motivationId: 'mo-1' },
      expiresAt: '2026-11-23T20:00:00.000Z',
    });

    expect(checkout).toMatchObject({
      checkoutId: 'ch_1',
      redirectUrl: 'https://c.yoco.com/checkout/abc',
      status: 'created',
      amountCents: 29_500,
      mode: 'test',
      clientReferenceId: 'MO000123-ABC123',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payments.yoco.com/api/checkouts');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk_test_abc123',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'MO000123-ABC123',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      amount: 29_500,
      currency: 'ZAR',
      successUrl: 'https://alloutdoor.co.za/pack?payment=return',
      cancelUrl: 'https://alloutdoor.co.za/pack?payment=return',
      failureUrl: 'https://alloutdoor.co.za/pack?payment=return',
      clientReferenceId: 'MO000123-ABC123',
      metadata: { reference: 'MO000123-ABC123', motivationId: 'mo-1' },
      expiresAt: '2026-11-23T20:00:00.000Z',
    });
  });

  it('surfaces a create failure instead of a blank redirect', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ message: 'bad key' }, 403),
    ) as never;
    await expect(
      makeService().createCheckout({
        amountZarCents: 100,
        reference: 'ref',
        returnUrl: 'https://app/',
      }),
    ).rejects.toThrow(/403/);
  });

  it('reads the authoritative checkout status', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        id: 'ch_1',
        status: 'completed',
        paymentId: 'pay_1',
        amount: 29_500,
        processingMode: 'live',
        clientReferenceId: 'MO000123-ABC123',
      }),
    ) as never;
    const status = await makeService().getCheckout('ch_1');
    expect(status).toMatchObject({
      status: 'completed',
      paymentId: 'pay_1',
      amountCents: 29_500,
      mode: 'live',
      clientReferenceId: 'MO000123-ABC123',
    });
  });

  it('returns null for a checkout Yoco does not know', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ description: 'not found' }, 404),
    ) as never;
    await expect(makeService().getCheckout('ch_missing')).resolves.toBeNull();
  });

  it('refunds through the checkout id and reports the outcome', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ id: 'ch_1', refundId: 'rf_1', status: 'succeeded' }),
    );
    global.fetch = fetchMock as never;
    const result = await makeService().refundCheckout('ch_1', 29_500);
    expect(result).toMatchObject({ success: true, refundId: 'rf_1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://payments.yoco.com/api/checkouts/ch_1/refund',
    );
    expect(JSON.parse(String(init.body))).toEqual({ amount: 29_500 });
  });

  it('reports a failed refund without throwing', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ message: 'nope' }, 400),
    ) as never;
    await expect(makeService().refundCheckout('ch_1')).resolves.toMatchObject({
      success: false,
    });
  });

  it('recovers our reference from either Yoco field', () => {
    const svc = makeService();
    expect(
      svc.referenceOf({
        checkoutId: 'ch_1',
        redirectUrl: '',
        status: 'created',
        paymentId: null,
        amountCents: 1,
        mode: 'test',
        clientReferenceId: 'MO-1',
        metadata: null,
      }),
    ).toBe('MO-1');
    expect(svc.referenceOf({ metadata: { reference: 'MO-2' } })).toBe('MO-2');
    expect(svc.referenceOf({ metadata: {} })).toBeNull();
  });
});
