// ManualPaymentsService transitively imports TransactionsService (for
// GG_BANK_DETAILS) which pulls ESM-only meilisearch — stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { ManualPaymentsService } from './manual-payments.service';

function makeService(over: Record<string, jest.Mock> = {}) {
  // Shared mocks so both the interactive-transaction client (txc, used by
  // markPayoutBatchPaid) and the plain client (used by cancel/freeze) honour
  // the same overrides — a test only exercises one path.
  const batchUpdateMany = over.batchUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const batchCreate = jest.fn().mockResolvedValue({ id: 'B1', grandTotal: 15_000 });
  const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const txFindMany = over.txFindMany ?? jest.fn().mockResolvedValue([]);

  const txcMock = {
    payoutBatch: { create: batchCreate, updateMany: batchUpdateMany },
    transaction: { updateMany: txUpdateMany, findMany: txFindMany },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (txc: typeof txcMock) => unknown) => fn(txcMock)),
    payoutBatch: { updateMany: batchUpdateMany, findUnique: jest.fn(), findMany: jest.fn() },
    transaction: { updateMany: txUpdateMany, findMany: txFindMany },
  };
  const transactions = {};
  const zohoBooks = { markCommissionInvoicePaid: jest.fn().mockResolvedValue(undefined) };
  const service = new ManualPaymentsService(
    prisma as never,
    transactions as never,
    zohoBooks as never,
  );
  return {
    service, prisma, zohoBooks, txcMock,
    mocks: { batchUpdateMany, batchCreate, txUpdateMany, txFindMany },
  };
}

describe('ManualPaymentsService.markPayoutBatchPaid', () => {
  it('claims PENDING→PAID, stamps lines, fires Zoho per payout', async () => {
    const { service, prisma, zohoBooks } = makeService({
      batchUpdateMany: jest.fn().mockResolvedValue({ count: 1 }),
      txFindMany: jest.fn().mockResolvedValue([{ id: 'TX1' }, { id: 'TX2' }]),
    });

    const res = await service.markPayoutBatchPaid('B1', 'admin_1');

    // atomic claim to PAID
    expect(prisma.payoutBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'B1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'PAID', paidById: 'admin_1' }),
      }),
    );
    // paidOutAt stamped on the batch's lines
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { payoutBatchId: 'B1', paidOutAt: null },
        data: expect.objectContaining({ paidOutAt: expect.any(Date) }),
      }),
    );
    // Zoho fired for each RELEASED payout
    expect(zohoBooks.markCommissionInvoicePaid).toHaveBeenCalledTimes(2);
    expect(res.settledPayouts).toBe(2);
  });

  it('is idempotent: a non-pending batch (claim count 0) throws and settles nothing', async () => {
    const { service, prisma, zohoBooks } = makeService({
      batchUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(service.markPayoutBatchPaid('B1', 'admin_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(zohoBooks.markCommissionInvoicePaid).not.toHaveBeenCalled();
  });

  it('still settles even if a Zoho call fails (best-effort)', async () => {
    const { service, zohoBooks } = makeService({
      batchUpdateMany: jest.fn().mockResolvedValue({ count: 1 }),
      txFindMany: jest.fn().mockResolvedValue([{ id: 'TX1' }]),
    });
    zohoBooks.markCommissionInvoicePaid.mockRejectedValueOnce(new Error('books down'));
    const res = await service.markPayoutBatchPaid('B1', 'admin_1');
    expect(res.settledPayouts).toBe(1); // not blocked by Zoho failure
  });
});

describe('ManualPaymentsService.cancelPayoutBatch', () => {
  it('claims PENDING→CANCELLED and returns lines to the queue', async () => {
    const { service, prisma } = makeService({
      batchUpdateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    await service.cancelPayoutBatch('B1');
    expect(prisma.payoutBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'B1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    // payoutBatchId cleared (only on unpaid lines)
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { payoutBatchId: 'B1', paidOutAt: null },
        data: { payoutBatchId: null },
      }),
    );
  });

  it('refuses to cancel a non-pending batch', async () => {
    const { service, prisma } = makeService({
      batchUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(service.cancelPayoutBatch('B1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });
});

describe('ManualPaymentsService.createPayoutBatch', () => {
  it('refuses when nothing is due', async () => {
    const { service } = makeService();
    jest
      .spyOn(service, 'getPayoutsDue')
      .mockResolvedValue({ payouts: [], refunds: [] } as never);
    await expect(service.createPayoutBatch('admin_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('freezes due rows into a batch + links them (count matches)', async () => {
    const { service, txcMock } = makeService();
    jest.spyOn(service, 'getPayoutsDue').mockResolvedValue({
      payouts: [
        {
          id: 'TX1',
          orderReference: 'UM1',
          sellerPayout: 15_000,
          seller: {
            username: 'jan',
            email: 'j@x.co',
            phone: '0820000000',
            bankAccountHolder: 'Jan',
            bankName: 'FNB',
            bankAccountNumber: '62100',
            bankBranchCode: '250655',
            bankAccountType: 'cheque',
          },
        },
      ],
      refunds: [],
    } as never);
    // one line in → updateMany links exactly 1
    txcMock.transaction.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await service.createPayoutBatch('admin_1');
    expect(res.batchId).toBe('B1');
    expect(res.included).toBe(1);
    expect(typeof res.csv).toBe('string');
    expect(txcMock.payoutBatch.create).toHaveBeenCalled();
  });

  it('aborts if the linked count does not match the snapshot (concurrent freeze)', async () => {
    const { service, txcMock } = makeService();
    jest.spyOn(service, 'getPayoutsDue').mockResolvedValue({
      payouts: [
        {
          id: 'TX1',
          orderReference: 'UM1',
          sellerPayout: 15_000,
          seller: {
            username: 'jan', email: null, phone: null,
            bankAccountHolder: 'Jan', bankName: 'FNB',
            bankAccountNumber: '62100', bankBranchCode: '250655', bankAccountType: 'cheque',
          },
        },
      ],
      refunds: [],
    } as never);
    txcMock.transaction.updateMany.mockResolvedValueOnce({ count: 0 }); // grabbed by a concurrent batch
    await expect(service.createPayoutBatch('admin_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
