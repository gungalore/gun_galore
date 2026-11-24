jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

// Peach's Payouts product has NO webhook-signing control, so its live
// deliveries arrive unsigned. Accepting them is only safe because the handler
// treats the body as a hint and re-queries the Payouts API. These tests pin the
// two halves of that contract:
//
//   1. an unsigned delivery is recognised as 'unsigned' (not 'invalid'), while
//      a delivery that DOES carry a signature is still verified and rejected;
//   2. when the API cannot confirm the payout/verification, nothing is written —
//      the body alone never moves money.

function makeService() {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const attemptUpdate = jest.fn().mockResolvedValue({});
  const userUpdate = jest.fn().mockResolvedValue({});
  const alertCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    peachPayoutAttempt: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'attempt-1',
        payoutId: 'payout-1',
        transactionId: 'tx-1',
        completedAt: null,
        transaction: { id: 'tx-1', paymentProvider: 'PEACH' },
      }),
      update: attemptUpdate,
    },
    transaction: { updateMany },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        username: 'seller',
        email: 's@example.com',
        firstName: 'S',
        phone: null,
      }),
      update: userUpdate,
    },
    adminAlert: { create: alertCreate },
    sellerChargeRecovery: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const peach = {
    parsePayoutWebhook: jest.fn(() => ({ payoutId: 'payout-1', status: 'successful', code: '0' })),
    parseBanvWebhook: jest.fn(() => ({
      bankVerificationId: 'banv-1',
      status: 'successful',
      resultCode: '0',
      matches: {},
    })),
    getPayoutStatus: jest.fn().mockResolvedValue(null),
    getBankVerificationResult: jest.fn().mockResolvedValue(null),
    verifyPayoutWebhookSignature: jest.fn(),
    isFloatShortageCode: (code: string | undefined) =>
      /^2900\.002\./.test(code ?? ''),
  };

  const svc = Object.create(TransactionsService.prototype) as Record<string, any>;
  Object.assign(svc, {
    prisma,
    peach,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    notifications: {
      bankVerificationPassed: jest.fn().mockResolvedValue(undefined),
      bankVerificationFailed: jest.fn().mockResolvedValue(undefined),
    },
    zohoBooks: { settlePayoutDocuments: jest.fn().mockResolvedValue(undefined) },
  });
  return { svc: svc as TransactionsService, prisma, peach, updateMany, attemptUpdate, userUpdate };
}

describe('Peach payout/BANV webhook trust model', () => {
  it('treats a delivery with no signature as unsigned, not invalid', () => {
    const { svc } = makeService();
    expect(svc.verifyPeachPayoutWebhook('{}', {}, {}, 'https://x/webhook')).toBe('unsigned');
  });

  it('still rejects a delivery that carries a bad signature', () => {
    const { svc, peach } = makeService();
    peach.verifyPayoutWebhookSignature.mockReturnValue(false);
    const verdict = svc.verifyPeachPayoutWebhook(
      '{}',
      {},
      { id: 'i', timestamp: 't', signature: 'bad' },
      'https://x/webhook',
    );
    expect(verdict).toBe('invalid');
  });

  it('accepts a correctly signed delivery', () => {
    const { svc, peach } = makeService();
    peach.verifyPayoutWebhookSignature.mockReturnValue(true);
    const verdict = svc.verifyPeachPayoutWebhook(
      '{}',
      {},
      { id: 'i', timestamp: 't', signature: 'ok' },
      'https://x/webhook',
    );
    expect(verdict).toBe('valid');
  });

  it('writes NOTHING when the Payouts API does not know the payout, even if the body says successful', async () => {
    const { svc, updateMany, attemptUpdate } = makeService();
    await svc.handlePeachPayoutWebhook({ status: 'successful' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(attemptUpdate).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the BANV API cannot confirm the verification, even if the body says successful', async () => {
    const { svc, userUpdate } = makeService();
    await svc.handlePeachBanvWebhook({ status: 'successful' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('leaves a float-shortage failure DUE, not held (retry after top-up)', async () => {
    const { svc, peach, updateMany, attemptUpdate, prisma } = makeService();
    peach.parsePayoutWebhook.mockReturnValue({
      payoutId: 'payout-1',
      status: 'failed',
      code: '2900.002.000',
    });
    peach.getPayoutStatus.mockResolvedValue({
      status: 'failed',
      resultCode: '2900.002.000',
      error: 'Load more funds and try again or try a lower amount',
    });

    await svc.handlePeachPayoutWebhook({ payoutId: 'payout-1' });

    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', terminalAt: expect.any(Date) }),
      }),
    );
    // Held rows are excluded from the due queue — a float shortage must not
    // stop tomorrow's run from paying.
    const txWrite = updateMany.mock.calls[updateMany.mock.calls.length - 1][0];
    expect(txWrite.data).toMatchObject({
      payoutHeldAt: null,
      payoutHoldReason: null,
      payoutRequestedAt: null,
      gatewayPayoutId: null,
    });
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'PEACH_PAYOUT_FLOAT_SHORTAGE' }),
      }),
    );
  });

  it('still HOLDS a genuine payout rejection (bad account is not retried blindly)', async () => {
    const { svc, peach, updateMany } = makeService();
    peach.parsePayoutWebhook.mockReturnValue({
      payoutId: 'payout-1',
      status: 'failed',
      code: '2001.002.106',
    });
    peach.getPayoutStatus.mockResolvedValue({
      status: 'failed',
      resultCode: '2001.002.106',
      error: 'There is no account associated with the account number',
    });

    await svc.handlePeachPayoutWebhook({ payoutId: 'payout-1' });

    const txWrite = updateMany.mock.calls[updateMany.mock.calls.length - 1][0];
    expect(txWrite.data.payoutHeldAt).toEqual(expect.any(Date));
    expect(txWrite.data.payoutHoldReason).toContain('no account associated');
  });
});
