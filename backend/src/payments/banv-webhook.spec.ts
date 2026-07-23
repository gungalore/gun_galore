// Verifies the Peach BANV result webhook drives the full seller loop:
// pass → bankVerifiedAt + resolve task + quiet confirmation;
// mismatch/failed → payouts stay held + admin alert + seller notified on
// every channel. Mock harness mirrors chargeback-webhook.service.spec.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

const USER = {
  id: 'U1',
  username: 'sam',
  email: 'sam@x.co',
  firstName: 'Sam',
  phone: '0830000000',
  bankVerifiedAt: null,
};

function makeService(opts: { user?: Record<string, unknown> | null; banv: Record<string, unknown> }) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.user === undefined ? USER : opts.user),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    bankVerificationPassed: jest.fn().mockResolvedValue(undefined),
    bankVerificationFailed: jest.fn().mockResolvedValue(undefined),
  };
  const peach = {
    parseBanvWebhook: jest.fn().mockReturnValue(opts.banv),
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    notifications as never,
    peach as never,
    {} as never,
    {} as never,
    { recordInternal: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { createCommissionInvoice: jest.fn() } as never,
    { notifyItemSold: jest.fn() } as never,
    { build: jest.fn() } as never,
  );
  return { service, prisma, notifications };
}

const banv = (over: Record<string, unknown> = {}) => ({
  bankVerificationId: 'bv1',
  status: 'successful',
  resultCode: '2002.000.000',
  matches: {
    accountNumber: 'positive',
    idNumber: 'positive',
    accountOpen: 'positive',
    accountAcceptsCredits: 'positive',
    lastName: 'positive',
  },
  ...over,
});

describe('handlePeachBanvWebhook', () => {
  it('PASS → stamps bankVerifiedAt, resolves the fix-it task, quiet confirmation, NO alert', async () => {
    const { service, prisma, notifications } = makeService({ banv: banv() });
    await service.handlePeachBanvWebhook({});
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankVerifiedAt: expect.any(Date) }),
      }),
    );
    expect(notifications.resolveByEntity).toHaveBeenCalledWith('bank', 'U1');
    expect(notifications.bankVerificationPassed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'U1' }),
    );
    expect(notifications.bankVerificationFailed).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('MISMATCH (ID does not match holder) → held + urgent alert + seller notified kind=mismatch', async () => {
    const { service, prisma, notifications } = makeService({
      banv: banv({ matches: { accountNumber: 'positive', idNumber: 'negative', accountOpen: 'positive', accountAcceptsCredits: 'positive' } }),
    });
    await service.handlePeachBanvWebhook({});
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankVerifiedAt: null }),
      }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'BANK_VERIFY_MISMATCH', urgent: true }),
      }),
    );
    expect(notifications.bankVerificationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'U1', kind: 'mismatch', email: 'sam@x.co', phone: '0830000000' }),
    );
    expect(notifications.bankVerificationPassed).not.toHaveBeenCalled();
  });

  it('advisory-only lastName negative still PASSES (never blocks alone)', async () => {
    const { service, notifications } = makeService({
      banv: banv({ matches: { accountNumber: 'positive', idNumber: 'positive', accountOpen: 'positive', accountAcceptsCredits: 'positive', lastName: 'negative' } }),
    });
    await service.handlePeachBanvWebhook({});
    expect(notifications.bankVerificationPassed).toHaveBeenCalled();
    expect(notifications.bankVerificationFailed).not.toHaveBeenCalled();
  });

  it('FAILED (service error) → seller notified kind=failed + non-urgent alert', async () => {
    const { service, prisma, notifications } = makeService({
      banv: banv({ status: 'failed', resultCode: '2001.002.106' }),
    });
    await service.handlePeachBanvWebhook({});
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'BANK_VERIFY_FAILED' }),
      }),
    );
    expect(notifications.bankVerificationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'failed' }),
    );
  });

  it('pending/processing → no writes, no notifications', async () => {
    const { service, prisma, notifications } = makeService({
      banv: banv({ status: 'processing' }),
    });
    await service.handlePeachBanvWebhook({});
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(notifications.bankVerificationFailed).not.toHaveBeenCalled();
  });

  it('unknown verification id → logged, nothing else', async () => {
    const { service, prisma, notifications } = makeService({ user: null, banv: banv() });
    await service.handlePeachBanvWebhook({});
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(notifications.bankVerificationPassed).not.toHaveBeenCalled();
  });
});
