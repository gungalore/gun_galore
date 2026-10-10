// Phase 2 — the stale gateway-checkout reconcile sweep. This locks the three
// outcomes: a lost-webhook PAID order is recovered via markPaid (never
// released), an abandoned non-auction checkout releases the listing + deletes
// the dead tx, an abandoned auction win is handed back to the auction
// lifecycle with a LAPSED window (never flipped ACTIVE), and a transient
// status-lookup failure releases nothing.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

function makeService() {
  const prisma = {
    transaction: {
      findMany: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    listing: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (t: unknown) => unknown)({}),
    ),
  };
  const ozow = { getPaymentStatus: jest.fn() };
  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never,
    ozow as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const markPaid = jest
    .spyOn(
      service as unknown as {
        markPaid: (...args: unknown[]) => Promise<void>;
      },
      'markPaid',
    )
    .mockResolvedValue(undefined);
  return { service, prisma, ozow, markPaid };
}

const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'TX1',
  buyerTotal: 500_000,
  gatewayCheckoutId: 'PAY1',
  quantity: 1,
  listingId: 'L1',
  buyerId: 'B1',
  listing: {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'BUY_NOW',
    trackInventory: false,
    status: 'PAYMENT_PENDING',
  },
  ...over,
});

describe('reconcileStaleGatewayCheckouts', () => {
  it('releases an abandoned legacy BUY_NOW checkout to ACTIVE + deletes the tx', async () => {
    const { service, prisma, ozow } = makeService();
    prisma.transaction.findMany.mockResolvedValue([candidate()]);
    ozow.getPaymentStatus.mockResolvedValue({
      isSuccess: false,
      status: 'Incomplete',
    });

    const res = await service.reconcileStaleGatewayCheckouts();

    expect(res).toEqual({ recovered: 0, released: 1 });
    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'PAYMENT_PENDING' },
      data: { status: 'ACTIVE' },
    });
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
  });

  it('hands an abandoned auction win back with a LAPSED window, never ACTIVE', async () => {
    const { service, prisma, ozow } = makeService();
    prisma.transaction.findMany.mockResolvedValue([
      candidate({
        listing: {
          id: 'L1',
          sellerId: 'S1',
          listingType: 'AUCTION',
          trackInventory: false,
          status: 'PAYMENT_PENDING',
        },
      }),
    ]);
    ozow.getPaymentStatus.mockResolvedValue({
      isSuccess: false,
      status: 'Incomplete',
    });

    await service.reconcileStaleGatewayCheckouts();

    const data = prisma.listing.updateMany.mock.calls[0][0].data;
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined();
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
  });

  it('recovers a PAID order whose webhook was lost instead of releasing it', async () => {
    const { service, prisma, ozow, markPaid } = makeService();
    prisma.transaction.findMany.mockResolvedValue([candidate()]);
    ozow.getPaymentStatus.mockResolvedValue({
      transactionId: 'txn',
      merchantReference: 'ref',
      status: 'Successful',
      amountCents: 500_000,
      isSuccess: true,
    });

    const res = await service.reconcileStaleGatewayCheckouts();

    expect(res).toEqual({ recovered: 1, released: 0 });
    expect(markPaid).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it('releases nothing when the Ozow status lookup fails (transient)', async () => {
    const { service, prisma, ozow, markPaid } = makeService();
    prisma.transaction.findMany.mockResolvedValue([candidate()]);
    ozow.getPaymentStatus.mockRejectedValue(new Error('ozow 503'));

    const res = await service.reconcileStaleGatewayCheckouts();

    expect(res).toEqual({ recovered: 0, released: 0 });
    expect(markPaid).not.toHaveBeenCalled();
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });
});
