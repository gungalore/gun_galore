// Chargeback / dispute deliveries must reach the money-safety handler instead
// of being dropped by the `type !== 'transaction.complete'` early return. Ozow
// documents no such event today, so this is defensive wiring, but the routing
// itself is what these tests lock down.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

function makeService() {
  const prisma = {
    transaction: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const ozow = {
    parseTransactionWebhook: jest
      .fn()
      .mockReturnValue({ status: 'Incomplete' }),
  };
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
  const spy = jest
    .spyOn(
      service as unknown as {
        handleChargebackEvent: (...args: unknown[]) => Promise<void>;
      },
      'handleChargebackEvent',
    )
    .mockResolvedValue(undefined);
  return { service, prisma, spy };
}

describe('Ozow webhook dispatch — chargeback routing', () => {
  it('routes a chargeback event to the handler with its references', async () => {
    const { service, prisma, spy } = makeService();

    await service.handleOzowWebhook({
      type: 'chargeback.created',
      data: { PaymentId: 'PAY1', TransactionReference: 'REF1' },
    });

    expect(spy).toHaveBeenCalledWith({
      paymentId: 'PAY1',
      merchantReference: 'REF1',
      type: 'chargeback.created',
    });
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  it('routes a dispute event', async () => {
    const { service, spy } = makeService();
    await service.handleOzowWebhook({
      type: 'payment.dispute.opened',
      data: {},
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not route a normal transaction.complete event to chargeback', async () => {
    const { service, spy } = makeService();
    await service.handleOzowWebhook({
      type: 'transaction.complete',
      data: { Status: 'Incomplete' },
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
