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
  // Peach dispute path: handlePeachDispute → parseWebhookEvent → chargeback
  // handler. parseWebhookEvent returns the Peach shape (checkoutId), which
  // the dispute handler maps to paymentId and matches on peachCheckoutId.
  const peach = {
    parseWebhookEvent: jest.fn().mockReturnValue({
      checkoutId: 'pay_1',
      resultCode: opts.type ?? 'dispute',
    }),
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    {} as never,
    peach as never,
    {} as never,
    {} as never,
    tracking as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { createCommissionInvoice: jest.fn().mockResolvedValue(undefined) } as never, // zohoBooks (P0.6)
    { notifyItemSold: jest.fn().mockResolvedValue(undefined) } as never, // wishlistAlerts (P5.2)
    { build: jest.fn().mockResolvedValue(Buffer.from('')) } as never, // saps534 (FLOW-F4 M21)
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
  it('held funds → flips to DISPUTED + raises CHARGEBACK_INITIATED', async () => {
    const { service, prisma, tracking } = makeService({ tx: txAt('HELD') });
    await service.handlePeachDispute({});
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentStatus: 'DISPUTED' } }),
    );
    expect(alertTypes(prisma)).toContain('CHARGEBACK_INITIATED');
    expect(tracking.recordInternal).toHaveBeenCalled();
  });

  it('after payout (RELEASED) → urgent alert, NO status change, no refund', async () => {
    const { service, prisma } = makeService({ tx: txAt('RELEASED') });
    await service.handlePeachDispute({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(alertTypes(prisma)).toContain('CHARGEBACK_AFTER_PAYOUT');
  });

  it('already refunded → flags double-claim, no status change', async () => {
    const { service, prisma } = makeService({ tx: txAt('REFUNDED') });
    await service.handlePeachDispute({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(alertTypes(prisma)).toContain('CHARGEBACK_AFTER_REFUND');
  });

  it('already DISPUTED → idempotent no-op (no alert, no update)', async () => {
    const { service, prisma } = makeService({ tx: txAt('DISPUTED') });
    await service.handlePeachDispute({});
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('unmatched payment → raises CHARGEBACK_UNMATCHED', async () => {
    const { service, prisma } = makeService({ tx: null });
    await service.handlePeachDispute({});
    expect(alertTypes(prisma)).toContain('CHARGEBACK_UNMATCHED');
  });

  it('race (claim count 0) → CHARGEBACK_RACE, no recursion', async () => {
    const { service, prisma } = makeService({ tx: txAt('HELD'), claimCount: 0 });
    await service.handlePeachDispute({});
    expect(alertTypes(prisma)).toContain('CHARGEBACK_RACE');
  });
});
