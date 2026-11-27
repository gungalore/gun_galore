// TransactionsService transitively imports ESM-only meilisearch; stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from '../payments/transactions.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ORDER PAYMENT CONFIRMATION (multi-item checkout).
 *
 * Pins: the CURRENT session pays the order exactly once; a success carrying a
 * SUPERSEDED ref/checkout raises ORDER_PAYMENT_SUPERSEDED and never marks it
 * paid; an amount mismatch alerts and never marks it paid; the fan-out marks
 * every child through the normal money-state and asks for ONE buyer
 * confirmation.
 * ────────────────────────────────────────────────────────────────────────────
 */

type OrderRow = {
  id: string;
  buyerId: string;
  status: string;
  paidAt: Date | null;
  cancelledAt?: Date | null;
  buyerTotal: number;
  paymentProvider: string;
  gatewayCheckoutId: string | null;
  gatewayMerchantRef: string | null;
  gatewayPaymentId?: string | null;
  transactions?: {
    id: string;
    buyerTotal: number;
    paidAt: Date | null;
    refundOfId?: string | null;
    listing: { id: string; sellerId: string };
  }[];
};

const CURRENT_REF = 'ORD-O1-current';

function fullOrder(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'O1',
    buyerId: 'BUYER',
    status: 'AWAITING_PAYMENT',
    paidAt: null,
    buyerTotal: 20_000,
    paymentProvider: 'OZOW',
    gatewayCheckoutId: 'CHK-CURRENT',
    gatewayMerchantRef: CURRENT_REF,
    gatewayPaymentId: null,
    transactions: [
      {
        id: 'TX1',
        buyerTotal: 10_000,
        paidAt: null,
        refundOfId: null,
        listing: { id: 'L1', sellerId: 'S1' },
      },
      {
        id: 'TX2',
        buyerTotal: 10_000,
        paidAt: null,
        refundOfId: null,
        listing: { id: 'L2', sellerId: 'S2' },
      },
    ],
    ...over,
  };
}

function makeService(order: OrderRow = fullOrder()) {
  const prisma = {
    order: {
      findUnique: jest.fn().mockImplementation((args: { include?: unknown }) =>
        Promise.resolve(
          args?.include
            ? order
            : {
                id: order.id,
                status: order.status,
                paidAt: order.paidAt,
                cancelledAt: order.cancelledAt ?? null,
                buyerTotal: order.buyerTotal,
                gatewayCheckoutId: order.gatewayCheckoutId,
                gatewayMerchantRef: order.gatewayMerchantRef,
                paymentProvider: order.paymentProvider,
              },
        ),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    { orderConfirmedBuyerMulti: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { createOrderBuyerInvoice: jest.fn() } as never,
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
  const maybeConfirm = jest
    .spyOn(
      service as unknown as {
        maybeConfirmWholeOrder: (orderId: string) => Promise<void>;
      },
      'maybeConfirmWholeOrder',
    )
    .mockResolvedValue(undefined);
  const sync = jest.spyOn(service, 'syncOrderStatus').mockResolvedValue('PAID');
  const gatewayStatus = jest
    .spyOn(
      service as unknown as {
        getGatewayStatus: (...args: unknown[]) => Promise<unknown>;
      },
      'getGatewayStatus',
    )
    .mockResolvedValue({
      provider: 'OZOW',
      paymentId: 'PAY-1',
      merchantReference: CURRENT_REF,
      resultCode: 'success',
      amountCents: 20_000,
      currency: 'ZAR',
      isSuccess: true,
    });
  return { service, prisma, markPaid, maybeConfirm, sync, gatewayStatus };
}

const callMarkOrderPaid = (
  service: TransactionsService,
  result: Record<string, unknown>,
) =>
  (
    service as unknown as {
      markOrderPaid: (orderId: string, r: unknown) => Promise<unknown>;
    }
  ).markOrderPaid('O1', result);

describe('verifyOrderResult — the current session', () => {
  it('pays every child exactly once and asks for one confirmation', async () => {
    const { service, markPaid, maybeConfirm, sync, prisma } = makeService();

    const result = await service.verifyOrderResult('O1');

    expect(result).toMatchObject({ success: true });
    expect(markPaid).toHaveBeenCalledTimes(2);
    expect(markPaid.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'TX1',
      'TX2',
    ]);
    // The captured id is bound to the order before fan-out.
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'O1', gatewayPaymentId: null },
      data: {
        gatewayPaymentId: 'PAY-1',
        gatewayResultCode: 'success',
      },
    });
    expect(maybeConfirm).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('O1');
  });

  it('a duplicate confirmation is a no-op for already-paid children', async () => {
    const paidOrder = fullOrder({
      gatewayPaymentId: 'PAY-1',
      transactions: [
        {
          id: 'TX1',
          buyerTotal: 10_000,
          paidAt: new Date(),
          refundOfId: null,
          listing: { id: 'L1', sellerId: 'S1' },
        },
        {
          id: 'TX2',
          buyerTotal: 10_000,
          paidAt: new Date(),
          refundOfId: null,
          listing: { id: 'L2', sellerId: 'S2' },
        },
      ],
    });
    const { service, markPaid } = makeService(paidOrder);
    await callMarkOrderPaid(service, {
      paymentId: 'PAY-1',
      resultCode: 'success',
      amount: 20_000,
      currency: 'ZAR',
      merchantTransactionId: CURRENT_REF,
      isSuccess: true,
    });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('already processed order returns immediately', async () => {
    const { service, markPaid } = makeService(
      fullOrder({ paidAt: new Date(), status: 'PAID' }),
    );
    expect(await service.verifyOrderResult('O1')).toEqual({
      success: true,
      alreadyProcessed: true,
    });
    expect(markPaid).not.toHaveBeenCalled();
  });
});

describe('superseded sessions and amount mismatch', () => {
  it('a success on an OLD reference alerts and never marks the order paid', async () => {
    const { service, prisma, markPaid } = makeService();
    await expect(
      callMarkOrderPaid(service, {
        paymentId: 'PAY-OLD',
        resultCode: 'success',
        amount: 20_000,
        currency: 'ZAR',
        merchantTransactionId: 'ORD-O1-old',
        isSuccess: true,
      }),
    ).rejects.toThrow(/previous payment session/i);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_PAYMENT_SUPERSEDED',
          urgent: true,
        }),
      }),
    );
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('an amount mismatch alerts and never marks the order paid', async () => {
    const { service, prisma, markPaid } = makeService();
    await expect(
      callMarkOrderPaid(service, {
        paymentId: 'PAY-1',
        resultCode: 'success',
        amount: 19_999,
        currency: 'ZAR',
        merchantTransactionId: CURRENT_REF,
        isSuccess: true,
      }),
    ).rejects.toThrow(/amount does not match/i);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ORDER_PAYMENT_AMOUNT_MISMATCH',
          urgent: true,
        }),
      }),
    );
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('a webhook naming a superseded checkout alerts and does not apply', async () => {
    const order = fullOrder();
    const { service, prisma, markPaid } = makeService(order);
    // Direct match by old ref finds nothing; the parsed order id does.
    prisma.order.findFirst.mockResolvedValue(null);
    // markOrderPaid is never reached, so full order row is not needed.
    const handled = await (
      service as unknown as {
        handleWebhookForOrder: (
          provider: string,
          match: { merchantReference?: string },
          status: unknown,
        ) => Promise<boolean>;
      }
    ).handleWebhookForOrder(
      'OZOW',
      { merchantReference: 'ORD-O1-stale' },
      {
        provider: 'OZOW',
        paymentId: 'PAY-OLD',
        merchantReference: 'ORD-O1-stale',
        resultCode: 'success',
        amountCents: 20_000,
        currency: 'ZAR',
        isSuccess: true,
      },
    );
    expect(handled).toBe(true);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ORDER_PAYMENT_SUPERSEDED' }),
      }),
    );
    expect(markPaid).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('a cancelled order paid late alerts and does not fulfil', async () => {
    const { service, prisma, markPaid } = makeService(
      fullOrder({
        status: 'CANCELLED',
        cancelledAt: new Date(),
      }),
    );
    await expect(
      callMarkOrderPaid(service, {
        paymentId: 'PAY-1',
        resultCode: 'success',
        amount: 20_000,
        currency: 'ZAR',
        merchantTransactionId: CURRENT_REF,
        isSuccess: true,
      }),
    ).rejects.toThrow(/cancelled/i);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ORDER_PAID_AFTER_CANCEL' }),
      }),
    );
    expect(markPaid).not.toHaveBeenCalled();
  });
});
