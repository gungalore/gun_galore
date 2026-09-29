import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../shipping/tracking.service';
import { TransactionsService } from './transactions.service';

type PayoutOutcome = {
  payoutId: string;
  status: number;
  subStatus: number;
  errorMessage: string;
};
type AttemptUpdate = { where: unknown; data: Record<string, unknown> };
type TransactionUpdate = { where: unknown; data: Record<string, unknown> };

function setup(completedAt: Date | null = null) {
  const attemptUpdates: AttemptUpdate[] = [];
  const transactionUpdates: TransactionUpdate[] = [];
  const attempt = {
    id: 'attempt-1',
    transactionId: 'transaction-1',
    terminalAt: null as Date | null,
    completedAt,
  };
  const transactionClient = {
    ozowPayoutAttempt: {
      findUnique: jest.fn().mockResolvedValue(attempt),
      updateMany: jest.fn((update: AttemptUpdate) => {
        attemptUpdates.push(update);
        return Promise.resolve({ count: 1 });
      }),
    },
    transaction: {
      updateMany: jest.fn((update: TransactionUpdate) => {
        transactionUpdates.push(update);
        return Promise.resolve({ count: 1 });
      }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    ...transactionClient,
    adminAlert: { create: jest.fn().mockResolvedValue(undefined) },
    $transaction: jest.fn(
      (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
  const service = new TransactionsService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    tracking as unknown as TrackingService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const reconcile = (
    service as unknown as {
      reconcileOzowPayoutStatus: (outcome: PayoutOutcome) => Promise<void>;
    }
  ).reconcileOzowPayoutStatus.bind(service);
  return {
    attempt,
    attemptUpdates,
    transactionUpdates,
    prisma,
    tracking,
    reconcile,
  };
}

describe('Ozow payout outcome reconciliation', () => {
  it('records PayoutComplete without treating it as final', async () => {
    const { attemptUpdates, transactionUpdates, tracking, reconcile } = setup();
    await reconcile({
      payoutId: 'payout-1',
      status: 5,
      subStatus: 0,
      errorMessage: '',
    });

    const attemptUpdate = attemptUpdates[0];
    expect(attemptUpdate.data.completedAt).toBeInstanceOf(Date);
    expect(attemptUpdate.data).not.toHaveProperty('terminalAt');
    expect(transactionUpdates[0].data.paidOutAt).toBeInstanceOf(Date);
    expect(transactionUpdates[0].data.payoutRequestedAt).toBeNull();
    expect(tracking.recordInternal).toHaveBeenCalledWith(
      'transaction-1',
      'PAYOUT_SETTLED',
      expect.any(Object),
    );
  });

  it('does not hold or resubmit an insufficient-float payout', async () => {
    const { prisma, attemptUpdates, reconcile } = setup();
    await reconcile({
      payoutId: 'payout-1',
      status: 4,
      subStatus: 403,
      errorMessage: 'Insufficient balance',
    });

    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
    expect(attemptUpdates[0].data.terminalAt).toBeUndefined();
  });

  it('puts final failures on payout hold rather than making them automatically due', async () => {
    const { prisma, transactionUpdates, reconcile } = setup();
    await reconcile({
      payoutId: 'payout-1',
      status: 4,
      subStatus: 405,
      errorMessage: 'Invalid account number',
    });

    expect(transactionUpdates[0].where).toEqual({
      id: 'transaction-1',
      gatewayPayoutId: 'payout-1',
      releasedAt: { not: null },
    });
    expect(transactionUpdates[0].data.paidOutAt).toBeNull();
    expect(transactionUpdates[0].data.payoutRequestedAt).toBeNull();
    expect(transactionUpdates[0].data.payoutHeldAt).toBeInstanceOf(Date);
    expect(transactionUpdates[0].data.payoutHoldReason).toContain(
      'Review before any resubmission',
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('reconciles an isolated test attempt without touching the ledger', async () => {
    const { prisma, reconcile } = setup();
    prisma.ozowPayoutAttempt.findUnique = jest
      .fn()
      .mockResolvedValue(null) as never;
    const testUpdates: AttemptUpdate[] = [];
    (prisma as unknown as Record<string, unknown>).ozowPayoutTestAttempt = {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'test-1',
          terminalAt: null,
          completedAt: null,
        }),
      update: jest.fn((update: AttemptUpdate) => {
        testUpdates.push(update);
        return Promise.resolve({ count: 1 });
      }),
    };

    await reconcile({
      payoutId: 'payout-test-1',
      status: 5,
      subStatus: 0,
      errorMessage: 'Complete',
    });

    expect(testUpdates[0].data.completedAt).toBeInstanceOf(Date);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('marks a final-failure test attempt terminal without a ledger write', async () => {
    const { prisma, reconcile } = setup();
    prisma.ozowPayoutAttempt.findUnique = jest
      .fn()
      .mockResolvedValue(null) as never;
    const testUpdates: AttemptUpdate[] = [];
    (prisma as unknown as Record<string, unknown>).ozowPayoutTestAttempt = {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'test-1',
          terminalAt: null,
          completedAt: null,
        }),
      update: jest.fn((update: AttemptUpdate) => {
        testUpdates.push(update);
        return Promise.resolve({ count: 1 });
      }),
    };

    await reconcile({
      payoutId: 'payout-test-1',
      status: 1,
      subStatus: 405,
      errorMessage: 'The account number is invalid',
    });

    expect(testUpdates[0].data.terminalAt).toBeInstanceOf(Date);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('still holds a payout returned after an earlier PayoutComplete', async () => {
    const { prisma, attemptUpdates, reconcile } = setup(new Date());
    await reconcile({
      payoutId: 'payout-1',
      status: 90,
      subStatus: 9001,
      errorMessage: 'Returned unpaid',
    });

    expect(prisma.transaction.updateMany).toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalled();
    expect(attemptUpdates[0].data.terminalAt).toBeInstanceOf(Date);
  });
});
