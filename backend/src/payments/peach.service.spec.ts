import { PeachService } from './peach.service';

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
        reference: 'TX1',
        beneficiaryName: 'A Seller',
        bankAccountNumber: '123456789',
        branchCode: '250655',
        amountCents: 10_000,
      },
    ]);
    expect(r.success).toBe(false);
    expect(r.results[0].status).toBe('not_configured');
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
  it('buckets a successful payout', () => {
    const p = svc.parsePayoutWebhook({
      merchantPayoutId: 'TX1',
      payoutId: 'po_1',
      result: { code: '2000.000.000' },
    });
    expect(p.status).toBe('success');
    expect(p.merchantPayoutId).toBe('TX1');
  });
  it('buckets a failed payout', () => {
    const p = svc.parsePayoutWebhook({
      reference: 'TX2',
      result: { code: '2001.002.106' },
    });
    expect(p.status).toBe('failed');
    expect(p.merchantPayoutId).toBe('TX2');
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
    expect(
      svc.verifyWebhookSignature('raw', {}, {}, 'https://x/y'),
    ).toBe(true);
  });
});
