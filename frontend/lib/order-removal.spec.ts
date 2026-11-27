import { describe, expect, it, vi } from 'vitest';
import { removeOrderLine } from './order-removal';
import type { OrderDetail } from './order-page';

// Pending-order removal: after checkout the backend owns the reserved lines, so
// Remove must call DELETE and act on what it returns. These specs pin the four
// real outcomes with a mocked fetch.
const order = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  id: 'order-1',
  status: 'AWAITING_PAYMENT',
  orderReference: 'AO-1',
  itemsSubtotal: 10_000,
  shippingSubtotal: 5_000,
  handlingSubtotal: 0,
  processingFee: 1_500,
  buyerTotal: 16_500,
  paidAt: null,
  createdAt: '2026-11-27T10:00:00.000Z',
  lineItems: [
    {
      id: 'line-1',
      listingId: 'l-1',
      sellerId: 'seller-1',
      deliveryClass: 'GOODS',
      quantity: 1,
      unitPrice: 10_000,
      lineSubtotal: 10_000,
      listing: { id: 'l-1', title: 'Scope rings', images: [] },
      transaction: {
        id: 'tx-1',
        paymentStatus: 'HELD',
        shippingStatus: 'PENDING',
        shippingMethod: 'COURIER',
      },
    },
  ],
  canRemove: true,
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('DELETE /orders/:id/lines/:transactionId', () => {
  it('returns the re-priced order and the NEW payment session', async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse({
        cancelled: false,
        order: order({ buyerTotal: 12_000 }),
        payment: { redirectUrl: 'https://pay.example/new', paymentId: 'pay-2' },
      }),
    );
    const result = await removeOrderLine({
      orderId: 'order-1',
      transactionId: 'tx-2',
      request,
    });
    expect(request).toHaveBeenCalledWith(
      '/orders/order-1/lines/tx-2',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result).toEqual({
      kind: 'removed',
      order: expect.objectContaining({ id: 'order-1', buyerTotal: 12_000 }),
      redirectUrl: 'https://pay.example/new',
      paymentId: 'pay-2',
    });
  });

  it('reports the last-line cancellation (order: null)', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ cancelled: true, order: null }));
    await expect(
      removeOrderLine({ orderId: 'order-1', transactionId: 'tx-1', request }),
    ).resolves.toEqual({ kind: 'cancelled' });
  });

  it('treats a CANCELLED/empty returned order as cancelled too', async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse({
        cancelled: false,
        order: order({ status: 'CANCELLED', lineItems: [] }),
      }),
    );
    await expect(
      removeOrderLine({ orderId: 'order-1', transactionId: 'tx-1', request }),
    ).resolves.toEqual({ kind: 'cancelled' });
  });

  it('maps a 409 (already paid) to its own outcome, not a generic error', async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'This order has already been paid — lines can no longer be removed.' },
        409,
      ),
    );
    const result = await removeOrderLine({
      orderId: 'order-1',
      transactionId: 'tx-1',
      request,
    });
    expect(result.kind).toBe('paid');
    if (result.kind === 'paid') {
      expect(result.message).toMatch(/already been paid/i);
    }
  });

  it('surfaces a validation failure message', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: ['This item is no longer in the order'] }, 400),
      );
    const result = await removeOrderLine({
      orderId: 'order-1',
      transactionId: 'tx-1',
      request,
    });
    expect(result).toEqual({
      kind: 'error',
      message: 'This item is no longer in the order',
    });
  });

  it('survives a network failure without throwing', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      removeOrderLine({ orderId: 'order-1', transactionId: 'tx-1', request }),
    ).resolves.toEqual({
      kind: 'error',
      message: 'Could not reach the server. Please try again.',
    });
  });
});
