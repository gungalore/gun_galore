jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

function makeService(opts: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
  type?: string;
}) {
  const prisma = {
    transaction: {
      findFirst: jest.fn().mockResolvedValue(opts.tx),
      findUnique: jest.fn().mockResolvedValue(opts.tx),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const tracking = { recordInternal: jest.fn() };
  const stitch = {
    parseWebhookEvent: jest.fn().mockReturnValue({
      paymentId: 'pay_1',
      type: opts.type ?? 'payment.chargeback',
    }),
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    {} as never,
    stitch as never,
    {} as never,
    {} as never,
    tracking as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, tracking };
}

const txAt = (paymentStatus: string) => ({
  id: 'TX1',
  peachCheckoutId: 'pay_1',
  buyerTotal: 100_000,
  paymentStatus,
});

function alertTypes(prisma: { adminAlert: { create: jest.Mock } }) {
  return prisma.adminAlert.create.mock.calls.map((c) => c[0].data.type);
}

describe('TransactionsService chargeback webhook (P4.3)', () => {
  it('held funds → flips to DISPUTED + raises STITCH_CHARGEBACK_INITIATED', async () => {
    const { service, prisma, tracking } = makeService({ tx: txAt('HELD') });
    await service.handleStitchWebhook({});
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentStatus: 'DISPUTED' } }),
    );
    expect(alertTypes(prisma)).toContain('STITCH_CHARGEBACK_INITIATED');
    expect(tracking.recordInternal).toHaveBeenCalled();
  });

  it('after payout (RELEASED) → urgent alert, NO status change, no refund', async () => {
    const { service, prisma } = makeService({ tx: txAt('RELEASED') });
    await service.handleStitchWebhook({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(alertTypes(prisma)).toContain('STITCH_CHARGEBACK_AFTER_PAYOUT');
  });

  it('already refunded → flags double-claim, no status change', async () => {
    const { service, prisma } = makeService({ tx: txAt('REFUNDED') });
    await service.handleStitchWebhook({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(alertTypes(prisma)).toContain('STITCH_CHARGEBACK_AFTER_REFUND');
  });

  it('already DISPUTED → idempotent no-op (no alert, no update)', async () => {
    const { service, prisma } = makeService({ tx: txAt('DISPUTED') });
    await service.handleStitchWebhook({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('unmatched payment → raises STITCH_CHARGEBACK_UNMATCHED', async () => {
    const { service, prisma } = makeService({ tx: null });
    await service.handleStitchWebhook({});
    expect(alertTypes(prisma)).toContain('STITCH_CHARGEBACK_UNMATCHED');
  });

  it('race (claim count 0) → STITCH_CHARGEBACK_RACE, no recursion', async () => {
    const { service, prisma } = makeService({ tx: txAt('HELD'), claimCount: 0 });
    await service.handleStitchWebhook({});
    expect(alertTypes(prisma)).toContain('STITCH_CHARGEBACK_RACE');
  });
});
