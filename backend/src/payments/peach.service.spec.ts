import { PeachService } from './peach.service';
import { signParams } from './peach-signature';
import { evaluateBanvMatches, normaliseBankName } from './peach-banks';

// No PEACH_* env in the test runner → mock mode (inert). These lock the
// "safe when unconfigured" contract + the pure parsing/normalisation.
describe('PeachService (mock mode — unconfigured)', () => {
  const svc = new PeachService();

  it('createCheckout returns a mock- id and an 8-16 char merchant ref, never calls out', async () => {
    const r = await svc.createCheckout({
      amountZarCents: 150_00,
      merchantTransactionId: 'cmabc1234567890defghijklmn',
      shopperResultUrl: 'https://gungalore.co.za/checkout/complete',
    });
    expect(r.paymentId).toMatch(/^mock-/);
    expect(r.redirectUrl).toBe('');
    expect(r.merchantReference.length).toBeGreaterThanOrEqual(8);
    expect(r.merchantReference.length).toBeLessThanOrEqual(16);
  });

  it('refundPayment logs intent + returns MOCK_REFUND success (never a real reversal)', async () => {
    const r = await svc.refundPayment('pay_1', 5000);
    expect(r.success).toBe(true);
    expect(r.resultCode).toBe('MOCK_REFUND');
  });

  it('createPayout returns not_configured for each beneficiary (no disbursement)', async () => {
    const r = await svc.createPayout([
      {
        payoutId: '3f2c0d5e-1111-4222-8333-444455556666',
        bankName: 'FNB',
        accountHolder: 'A Seller',
        bankAccountNumber: '123456789',
        branchCode: '250655',
        amountCents: 10_000,
        reference: 'GG 12345678',
        proofEmail: 'seller@example.com',
      },
    ]);
    expect(r.success).toBe(false);
    expect(r.results[0].status).toBe('not_configured');
    expect(r.results[0].payoutId).toBe('3f2c0d5e-1111-4222-8333-444455556666');
  });

  it('createPayout with zero beneficiaries is a no-op success', async () => {
    const r = await svc.createPayout([]);
    expect(r).toEqual({ success: true, results: [] });
  });
});

describe('PeachService.parseWebhookEvent', () => {
  const svc = new PeachService();

  it('reads form-urlencoded dotted keys (checkout webhook shape)', () => {
    const evt = svc.parseWebhookEvent({
      checkoutId: 'chk_9',
      id: 'pay_9',
      merchantTransactionId: 'GGABC1234',
      'result.code': '000.000.000',
      paymentType: 'DB',
      amount: '150.00',
    });
    expect(evt.checkoutId).toBe('chk_9');
    expect(evt.paymentId).toBe('pay_9');
    expect(evt.merchantReference).toBe('GGABC1234');
    expect(evt.bucket).toBe('success');
    expect(evt.amountCents).toBe(15_000);
  });

  it('reads nested JSON result object (payment-links shape) + rejects a decline code', () => {
    const evt = svc.parseWebhookEvent({
      checkoutId: 'chk_9',
      result: { code: '800.100.150' },
    });
    expect(evt.bucket).toBe('rejected');
  });
});

describe('PeachService.parsePayoutWebhook', () => {
  const svc = new PeachService();
  it('passes the real webhook shape through (payoutId + lifecycle status)', () => {
    const p = svc.parsePayoutWebhook({
      payoutId: '84920878-fc32-494f-8e30-6a2465c9a456',
      status: 'successful',
      resultCode: '2000.000.000',
      lastUpdated: '2026-07-23T22:00:00.000Z',
    });
    expect(p.status).toBe('successful');
    expect(p.payoutId).toBe('84920878-fc32-494f-8e30-6a2465c9a456');
    expect(p.code).toBe('2000.000.000');
  });
  it('classifies from resultCode when status is absent', () => {
    const p = svc.parsePayoutWebhook({
      payoutId: 'po_2',
      resultCode: '2001.002.106',
    });
    expect(p.status).toBe('failed');
  });
});

describe('BANV evaluation + parsing', () => {
  const svc = new PeachService();
  it('parses a banv webhook and PASSES on account+id+open positives', () => {
    const evt = svc.parseBanvWebhook({
      bankVerificationId: '6e029f3f-21bf-425d-8f65-4eef2b5d8bb2',
      accountNumber: 'positive',
      idNumber: 'positive',
      accountOpen: 'positive',
      accountAcceptsCredits: 'positive',
      lastName: 'negative', // advisory only — must NOT block
      status: 'successful',
      resultCode: '2002.000.000',
    });
    expect(evt.bankVerificationId).toBe('6e029f3f-21bf-425d-8f65-4eef2b5d8bb2');
    expect(evaluateBanvMatches(evt.matches)).toBe('passed');
  });
  it('MISMATCHES when the ID does not match the account holder', () => {
    expect(
      evaluateBanvMatches({
        accountNumber: 'positive',
        accountOpen: 'positive',
        idNumber: 'negative',
        accountAcceptsCredits: 'positive',
      }),
    ).toBe('mismatch');
  });
  it('MISMATCHES when the account refuses credits or does not exist', () => {
    expect(
      evaluateBanvMatches({
        accountNumber: 'negative',
        accountOpen: 'positive',
        idNumber: 'positive',
      }),
    ).toBe('mismatch');
    expect(
      evaluateBanvMatches({
        accountNumber: 'positive',
        accountOpen: 'positive',
        idNumber: 'positive',
        accountAcceptsCredits: 'negative',
      }),
    ).toBe('mismatch');
  });
});

describe('normaliseBankName', () => {
  it('maps friendly frontend names + local spellings onto the Peach enum', () => {
    expect(normaliseBankName('Capitec')).toBe('CAPITEC BANK');
    expect(normaliseBankName('Standard Bank')).toBe('STANDARD BANK');
    expect(normaliseBankName('First National Bank')).toBe('FNB');
    expect(normaliseBankName('Bank Zero')).toBe('BANK ZERO MUTUAL BANK');
    expect(normaliseBankName('HBZ Bank')).toBe('HBZ BANK LIMITED');
    expect(normaliseBankName('TYMEBANK')).toBe('TYMEBANK'); // exact enum
    expect(normaliseBankName('Ubank')).toBe('UBANK LTD');
  });
  it('returns null for unmappable names (payout run skips with a reason)', () => {
    expect(normaliseBankName('Bank of Narnia')).toBeNull();
    expect(normaliseBankName('')).toBeNull();
    expect(normaliseBankName(null)).toBeNull();
  });
});

describe('PeachService.verifyWebhookSignature (dev passthrough)', () => {
  const svc = new PeachService();
  const OLD = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD;
  });
  it('accepts in non-production when no secret is configured (dev only)', () => {
    process.env.NODE_ENV = 'test';
    expect(svc.verifyWebhookSignature('raw', {}, {}, 'https://x/y')).toBe(true);
  });
});

describe('PeachService live HTTP contracts (fetch mocked)', () => {
  // These pin the EXACT wire shapes against Peach's documented API. The
  // mock-mode block above cannot catch a wrong body shape or a result code
  // read from the wrong dialect — both of which would only fail live.
  const OLD_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = OLD_FETCH;
  });

  function liveService(over: Record<string, any> = {}): PeachService {
    const svc = Object.create(PeachService.prototype) as Record<string, any>;
    Object.assign(svc, {
      isConfigured: true,
      entityId: 'e'.repeat(32),
      merchantId: 'm'.repeat(32),
      checkoutHost: 'https://checkout.example',
      refundHost: 'https://refund.example',
      payoutsHost: 'https://payouts.example',
      payoutsConfigured: true,
      payoutMerchantId: 'm'.repeat(32),
      secret: 's'.repeat(32),
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      ...over,
    });
    svc.getToken = async () => 'tok';
    svc.getPayoutToken = async () => 'ptok';
    return svc as PeachService;
  }

  it('creates a Checkout V2 checkout with a FLAT DOTTED entity key + decimal ZAR amount', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        checkoutId: 'chk_1',
        redirectUrl: 'https://pay.example/session/chk_1',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = liveService();
    const r = await svc.createCheckout({
      amountZarCents: 15_050,
      merchantTransactionId: 'tx_abcdef1234',
      shopperResultUrl: 'https://alloutdoor.co.za/checkout/complete?t=1',
      notificationUrl: 'https://alloutdoor.co.za/api/payments/webhook/peach',
    });

    expect(r.paymentId).toBe('chk_1');
    expect(r.redirectUrl).toBe('https://pay.example/session/chk_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://checkout.example/v2/checkout');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    // Peach validates the storefront origin against its allowlist.
    expect(init.headers.Origin).toBe('https://alloutdoor.co.za');

    const body = JSON.parse(init.body);
    // ⚠️ Peach's OpenAPI JSON example uses the dotted key. A nested
    // authentication object is not parsed and surfaces as "Channel not found".
    expect(body['authentication.entityId']).toBe('e'.repeat(32));
    expect(body.authentication).toBeUndefined();
    // Decimal ZAR (150.50), not cents.
    expect(body.amount).toBe(150.5);
    expect(body.currency).toBe('ZAR');
    expect(body.paymentType).toBe('DB');
    expect(body.nonce).toBeTruthy();
    expect(body.shopperResultUrl).toBe(
      'https://alloutdoor.co.za/checkout/complete?t=1',
    );
    expect(body.notificationUrl).toBe(
      'https://alloutdoor.co.za/api/payments/webhook/peach',
    );
    expect(body.merchantTransactionId.length).toBeGreaterThanOrEqual(8);
    expect(body.merchantTransactionId.length).toBeLessThanOrEqual(16);
  });

  it('refunds with FORM-ENCODED flat fields + a signature over those fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        'result.code': '000.100.110',
        'result.description': 'Request successfully processed',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = liveService();
    const r = await svc.refundPayment('pay_1', 5_000);

    expect(r.success).toBe(true);
    expect(r.resultCode).toBe('000.100.110');
    expect(r.message).toBe('Request successfully processed');

    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://refund.example/v1/checkout/refund');
    expect(init.method).toBe('POST');
    // ⚠️ The classic refund endpoint rejects a nested JSON body with
    // "authentication.entityId may not be null".
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const sent = Object.fromEntries(new URLSearchParams(init.body));
    expect(sent['authentication.entityId']).toBe('e'.repeat(32));
    expect(sent.amount).toBe('50.00');
    expect(sent.currency).toBe('ZAR');
    expect(sent.id).toBe('pay_1');
    expect(sent.paymentType).toBe('RF');
    const { signature, ...signed } = sent;
    expect(signature).toBe(signParams(signed, 's'.repeat(32)));
    expect(init.body).not.toContain('"authentication"');
  });

  it('classifies a FLAT V1 refund failure code as a failure (not success)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        'result.code': '700.400.200',
        'result.description': 'cannot refund',
      }),
    }) as unknown as typeof fetch;

    const r = await liveService().refundPayment('pay_1', 5_000);
    expect(r.success).toBe(false);
    expect(r.resultCode).toBe('700.400.200');
    expect(r.message).toBe('cannot refund');
  });

  it('still reads a NESTED result object for refunds (tolerant of either dialect)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { code: '000.000.000' } }),
    }) as unknown as typeof fetch;

    const r = await liveService().refundPayment('pay_1', 5_000);
    expect(r.success).toBe(true);
    expect(r.resultCode).toBe('000.000.000');
  });

  it('reports an HTTP error refund as a failure with the provider code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        'result.code': '800.900.300',
        'result.description': 'invalid authentication information',
      }),
    }) as unknown as typeof fetch;

    const r = await liveService().refundPayment('pay_1', 5_000);
    expect(r.success).toBe(false);
    expect(r.resultCode).toBe('800.900.300');
  });

  it('reads the nested V2 status result code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'pay_9',
        merchantTransactionId: 'GGABC1234',
        amount: '150.00',
        result: { code: '000.000.000' },
      }),
    }) as unknown as typeof fetch;

    const r = await liveService().getPaymentStatus('chk_9');
    expect(r.isSuccess).toBe(true);
    expect(r.paymentId).toBe('pay_9');
    expect(r.amountCents).toBe(15_000);
  });
});

describe('PeachService.getPayoutStatus — the endpoint Peach actually documents', () => {
  // 🚨 THIS USED TO CALL /payouts/{payoutId}. Peach has TWO lookups:
  //   GET /payouts/{payoutRequestId}      — the BATCH id Peach returns on create
  //   GET /payouts/status?payoutId=…      — the merchant-supplied id we mint
  // We only ever hold the merchant-supplied one, so the old call 404'd, the
  // cron read that as "Peach has no record", and after 15 minutes HELD the
  // payout and released its seller-charge reservation. Pinned here against the
  // reference (querypayoutrequestbypayoutid), 2026-11-20.
  function makeLiveService() {
    const svc = Object.create(PeachService.prototype) as Record<string, any>;
    Object.assign(svc, {
      payoutsConfigured: true,
      payoutMerchantId: 'a'.repeat(32),
      payoutsHost: 'https://payouts.example',
      getPayoutToken: async () => 'tok',
    });
    return svc as PeachService;
  }

  const OLD_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = OLD_FETCH;
  });

  it('queries /payouts/status?payoutId= and reads the matching entry from payouts[]', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        payoutRequestId: 'batch-1',
        payouts: [
          { payoutId: 'other', status: 'processing', resultCode: '2900.000.003' },
          { payoutId: 'p-1', status: 'successful', resultCode: '2000.000.000' },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await makeLiveService().getPayoutStatus('p-1');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/payouts/status?payoutId=p-1');
    expect(url).not.toMatch(/\/payouts\/p-1$/);
    expect(r).toEqual(
      expect.objectContaining({ payoutId: 'p-1', status: 'successful' }),
    );
  });

  it('returns null on 404 (unknown payout, not an error)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '',
    }) as unknown as typeof fetch;

    await expect(makeLiveService().getPayoutStatus('p-2')).resolves.toBeNull();
  });

  it('derives a status from resultCode when the payload omits one', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ payouts: [{ payoutId: 'p-3', resultCode: '2900.000.003' }] }),
    }) as unknown as typeof fetch;

    const r = await makeLiveService().getPayoutStatus('p-3');
    expect(r?.status).toBe('processing');
  });
});
