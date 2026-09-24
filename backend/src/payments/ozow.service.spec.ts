import { OzowService, OzowPayoutAttemptMaterial } from './ozow.service';
import { normaliseOzowBank, bankByBranchCode } from './ozow-banks';

function mockFetchQueue(payloads: unknown[]) {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ input, init });
    const payload = payloads.shift();
    if (payload === undefined) {
      throw new Error('No mocked Ozow response remains');
    }
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { calls, fetchImpl };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// No OZOW_* env in the test runner → mock mode (inert). These lock the
// "safe when unconfigured" contract + the pure parsing/normalisation.
describe('OzowService (mock mode — unconfigured)', () => {
  const svc = new OzowService();

  it('createPayment returns a mock- id and a ≤20 char merchant ref, never calls out', async () => {
    const r = await svc.createPayment({
      amountZarCents: 150_00,
      merchantTransactionId: 'cmabc1234567890defghijklmn',
      returnUrl: 'https://alloutdoor.co.za/checkout/complete',
    });
    expect(r.paymentId).toMatch(/^mock-/);
    expect(r.redirectUrl).toBe('');
    expect(r.merchantReference.length).toBeLessThanOrEqual(20);
  });

  it('refundPayment logs intent + returns MOCK_REFUND success (never a real reversal)', async () => {
    const r = await svc.refundPayment('txn_1', 5000);
    expect(r.success).toBe(true);
    expect(r.resultCode).toBe('MOCK_REFUND');
  });

  it('createPayout returns rejected with a reason (no disbursement)', async () => {
    const r = await svc.createPayout(
      {
        txId: 'tx1',
        merchantReference: 'AO123',
        customerBankReference: 'AO 123',
        accountHolder: 'A Seller',
        bankAccountNumber: '123456789',
        branchCode: '250655',
        amountCents: 10_000,
        notifyUrl: 'https://x/y',
      },
      () => Promise.resolve('attempt-test'),
    );
    expect(r.accepted).toBe(false);
    expect(r.errorMessage).toBe('payouts not configured');
  });
});

describe('OzowService.parseTransactionWebhook', () => {
  const svc = new OzowService();

  it('reads a full transaction.complete delivery', () => {
    const evt = svc.parseTransactionWebhook({
      TransactionId: 'txn-9',
      TransactionReference: 'AOABC1234',
      Amount: '150.00',
      Status: 'Successful',
    });
    expect(evt.transactionId).toBe('txn-9');
    expect(evt.merchantReference).toBe('AOABC1234');
    expect(evt.amountCents).toBe(15_000);
    expect(evt.status).toBe('Successful');
  });

  it('reads a thin delivery (id + status)', () => {
    const evt = svc.parseTransactionWebhook({
      id: 'txn-1',
      status: 'Error',
      reason: 'Cancelled',
    });
    expect(evt.transactionId).toBe('txn-1');
    expect(evt.status).toBe('Error');
    expect(evt.merchantReference).toBeUndefined();
  });
});

describe('OzowService payout verification request binding', () => {
  const svc = new OzowService();
  const expected = {
    txId: 'tx-1',
    siteCode: 'SITE-1',
    merchantReference: 'AO123',
    customerBankReference: 'AO 123',
    amountCents: 10_000,
    isRtc: false,
    notifyUrl: 'https://example.test/api/payments/webhook/ozow-payout',
    bankGroupId: 'bank-group',
    encryptedAccountNumber: 'ciphertext==',
    branchCode: '250655',
    ciphertext: 'wrapped-key',
    iv: 'iv',
    authTag: 'tag',
  };

  it('accepts a case-normalised callback matching the persisted request', () => {
    expect(
      svc.matchesPayoutVerification(
        {
          PayoutId: 'payout-1',
          SiteCode: 'site-1',
          MerchantReference: 'ao123',
          CustomerBankReference: 'ao 123',
          Amount: '100.00',
          IsRtc: false,
          NotifyUrl: expected.notifyUrl,
          BankingDetails: {
            BankGroupId: 'BANK-GROUP',
            AccountNumber: 'CIPHERTEXT==',
            BranchCode: '250655',
          },
        },
        expected,
      ),
    ).toBe(true);
  });

  it('rejects callback fields that differ from the persisted request', () => {
    expect(
      svc.matchesPayoutVerification(
        {
          payoutId: 'payout-1',
          siteCode: 'SITE-1',
          merchantReference: expected.merchantReference,
          customerBankReference: expected.customerBankReference,
          amount: '101.00',
          isRtc: false,
          notifyUrl: expected.notifyUrl,
          bankingDetails: {
            bankGroupId: expected.bankGroupId,
            accountNumber: expected.encryptedAccountNumber,
            branchCode: expected.branchCode,
          },
        },
        expected,
      ),
    ).toBe(false);
  });
});

describe('OzowService Payouts API request handling', () => {
  const envNames = [
    'OZOW_ENV',
    'OZOW_PAYOUT_API_KEY',
    'OZOW_PAYOUT_SITE_CODE',
    'OZOW_PAYOUT_ACCESS_TOKEN',
    'OZOW_PAYOUT_ENCRYPTION_KEY',
    'OZOW_PAYOUT_IS_RTC',
  ] as const;

  it('persists a unique wrapped key before sending the staging request and keeps account data encrypted', async () => {
    const originalEnv = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    const originalFetch = global.fetch;
    Object.assign(process.env, {
      OZOW_ENV: 'staging',
      OZOW_PAYOUT_API_KEY: 'test-api-key',
      OZOW_PAYOUT_SITE_CODE: 'test-site',
      OZOW_PAYOUT_ACCESS_TOKEN: 'test-access-token',
      OZOW_PAYOUT_ENCRYPTION_KEY:
        'test-master-wrapping-secret-32-characters-minimum',
      OZOW_PAYOUT_IS_RTC: 'true',
    });

    const fetchMock = mockFetchQueue([
      [
        {
          bankGroupId: 'bank-group',
          bankGroupName: 'FNB',
          universalBranchCode: '250655',
        },
      ],
      {
        payoutId: 'payout-1',
        payoutStatus: { status: 1, subStatus: 201, errorMessage: '' },
      },
    ]);
    global.fetch = fetchMock.fetchImpl;

    try {
      const svc = new OzowService();
      const localUrlResult = await svc.createPayout(
        {
          txId: 'tx-local',
          merchantReference: 'AOlocal',
          customerBankReference: 'AO local',
          accountHolder: 'Seller',
          bankAccountNumber: '123456789',
          branchCode: '250655',
          amountCents: 10_000,
          notifyUrl: 'http://localhost:3001/api/payments/webhook/ozow-payout',
        },
        () => Promise.resolve('unused'),
      );
      expect(localUrlResult.accepted).toBe(false);
      expect(localUrlResult.errorMessage).toContain('public HTTPS URL');
      expect(fetchMock.calls).toHaveLength(0);

      const persisted: { material?: OzowPayoutAttemptMaterial } = {};
      const result = await svc.createPayout(
        {
          txId: 'tx-1',
          merchantReference: 'AOtx1',
          customerBankReference: 'AO tx1',
          accountHolder: 'Seller',
          bankAccountNumber: '123456789',
          branchCode: '250655',
          amountCents: 10_000,
          notifyUrl: 'https://example.test/api/payments/webhook/ozow-payout',
        },
        async (material) => {
          expect(fetchMock.calls).toHaveLength(1);
          persisted.material = material;
          return Promise.resolve('attempt-1');
        },
      );

      expect(result).toMatchObject({
        payoutId: 'payout-1',
        attemptId: 'attempt-1',
        accepted: true,
      });
      expect(persisted.material?.siteCode).toBe('test-site');
      expect(persisted.material?.ciphertext).not.toBe(
        'test-master-wrapping-secret-32-characters-minimum',
      );
      const rawRequestBody = fetchMock.calls[1].init?.body;
      if (typeof rawRequestBody !== 'string') {
        throw new Error('Expected Ozow request body to be JSON text');
      }
      const requestBody = JSON.parse(rawRequestBody) as {
        isRtc: boolean;
        siteCode: string;
        bankingDetails: { accountNumber: string };
      };
      expect(requestBody.isRtc).toBe(false);
      expect(requestBody.bankingDetails.accountNumber).not.toBe('123456789');
      expect(requestBody.siteCode).toBe('test-site');
    } finally {
      for (const name of envNames) {
        if (originalEnv[name] === undefined) delete process.env[name];
        else process.env[name] = originalEnv[name];
      }
      global.fetch = originalFetch;
    }
  });

  it('checks status by payoutId and can recover an unrecorded payout by merchant reference', async () => {
    const originalEnv = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    const originalFetch = global.fetch;
    Object.assign(process.env, {
      OZOW_ENV: 'staging',
      OZOW_PAYOUT_API_KEY: 'test-api-key',
      OZOW_PAYOUT_SITE_CODE: 'test-site',
      OZOW_PAYOUT_ACCESS_TOKEN: 'test-access-token',
      OZOW_PAYOUT_ENCRYPTION_KEY:
        'test-master-wrapping-secret-32-characters-minimum',
      OZOW_PAYOUT_IS_RTC: 'false',
    });
    const fetchMock = mockFetchQueue([
      {
        id: 'payout-1',
        payoutStatus: { status: 5, subStatus: 0, errorMessage: 'Complete' },
      },
      [
        {
          id: 'payout-2',
          amount: 10,
          merchantReference: 'AO123',
          customerBankReference: 'AO 123',
          siteCode: 'test-site',
          isRtc: false,
          payoutStatus: { status: 1, subStatus: 201, errorMessage: '' },
        },
      ],
    ]);
    global.fetch = fetchMock.fetchImpl;

    try {
      const svc = new OzowService();
      await expect(svc.getPayoutStatus('payout-1')).resolves.toMatchObject({
        payoutId: 'payout-1',
        status: 5,
        subStatus: 0,
      });
      await expect(svc.getPayoutsByReference('AO123')).resolves.toMatchObject([
        {
          payoutId: 'payout-2',
          merchantReference: 'AO123',
          amountCents: 1000,
          status: 1,
          subStatus: 201,
        },
      ]);

      expect(requestUrl(fetchMock.calls[0].input)).toBe(
        'https://stagingpayoutsapi.ozow.com/v1/getpayout?payoutId=payout-1',
      );
      expect(requestUrl(fetchMock.calls[1].input)).toBe(
        'https://stagingpayoutsapi.ozow.com/v1/getpayoutbyreference',
      );
      const referenceSearchBody = fetchMock.calls[1].init?.body;
      if (typeof referenceSearchBody !== 'string') {
        throw new Error('Expected reference search body to be JSON text');
      }
      expect(JSON.parse(referenceSearchBody)).toEqual({
        pageSize: 10,
        pageIndex: 1,
        searchFields: [1],
        searchString: 'AO123',
      });
    } finally {
      for (const name of envNames) {
        if (originalEnv[name] === undefined) delete process.env[name];
        else process.env[name] = originalEnv[name];
      }
      global.fetch = originalFetch;
    }
  });
});

describe('normaliseOzowBank', () => {
  it('maps friendly frontend names + local spellings onto the Ozow bank', () => {
    expect(normaliseOzowBank('Capitec')?.groupName).toBe('Capitec Bank');
    expect(normaliseOzowBank('Standard Bank')?.groupName).toBe('Standard Bank');
    expect(normaliseOzowBank('First National Bank')?.groupName).toBe('FNB');
    expect(normaliseOzowBank('Bank Zero')?.groupName).toBe('Bank Zero');
  });

  it('returns null for unmappable names (payout run skips with a reason)', () => {
    expect(normaliseOzowBank('Bank of Narnia')).toBeNull();
    expect(normaliseOzowBank('')).toBeNull();
    expect(normaliseOzowBank(null)).toBeNull();
  });

  it('resolves a universal branch code to its bank', () => {
    expect(bankByBranchCode('250655')?.groupName).toBe('FNB');
    expect(bankByBranchCode('470010')?.groupName).toBe('Capitec Bank');
    expect(bankByBranchCode('nope')).toBeNull();
  });
});
