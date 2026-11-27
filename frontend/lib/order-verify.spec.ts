import { describe, expect, it, vi } from 'vitest';
import {
  destinationFor,
  orderCartListingIds,
  resolveVerifyTarget,
  verifyPathFor,
  verifyPaymentResult,
  type VerifyTarget,
} from './order-verify';

// /checkout/complete must verify the right rail (order vs transaction) and
// interpret the body flag honestly. The page itself is in app/** (not in the
// vitest include), so the whole decision lives here and is tested here.

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('picking what to verify', () => {
  it('prefers an order id from the query over a transaction id', () => {
    expect(
      resolveVerifyTarget({ orderId: 'order-1', transactionId: 'tx-1' }),
    ).toEqual({ kind: 'order', id: 'order-1' });
  });

  it('falls back to the stored markers (gateway drops the query)', () => {
    expect(
      resolveVerifyTarget({ pendingOrderId: 'order-2' }),
    ).toEqual({ kind: 'order', id: 'order-2' });
    expect(
      resolveVerifyTarget({ pendingTransactionId: 'tx-2' }),
    ).toEqual({ kind: 'transaction', id: 'tx-2' });
  });

  it('verifies the order before the legacy transaction marker', () => {
    expect(
      resolveVerifyTarget({
        pendingOrderId: 'order-3',
        pendingTransactionId: 'tx-3',
      }),
    ).toEqual({ kind: 'order', id: 'order-3' });
  });

  it('returns null when nothing identifies a payment', () => {
    expect(resolveVerifyTarget({})).toBeNull();
    expect(resolveVerifyTarget({ orderId: '   ', transactionId: '' })).toBeNull();
  });

  it('builds the API path and the destination per rail', () => {
    const order: VerifyTarget = { kind: 'order', id: 'order 1' };
    const tx: VerifyTarget = { kind: 'transaction', id: 'tx/1' };
    expect(verifyPathFor(order)).toBe('/orders/order%201/verify-result');
    expect(verifyPathFor(tx)).toBe('/transactions/tx%2F1/verify-result');
    expect(destinationFor(order)).toBe('/orders/order%201');
    expect(destinationFor(tx)).toBe('/transactions/tx%2F1');
  });
});

describe('interpreting the verify-result body', () => {
  it('is ok only on an explicit success body', async () => {
    const request = vi.fn().mockResolvedValue(okJson({ success: true }));
    await expect(
      verifyPaymentResult({ kind: 'order', id: 'o-1' }, request),
    ).resolves.toBe('ok');
    expect(request).toHaveBeenCalledWith(
      '/orders/o-1/verify-result',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('accepts alreadyProcessed as success', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(okJson({ success: true, alreadyProcessed: true }));
    await expect(
      verifyPaymentResult({ kind: 'order', id: 'o-1' }, request),
    ).resolves.toBe('ok');
  });

  it('is declined on a 200 with success false (never "paid")', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(okJson({ success: false, resultCode: 'Incomplete' }));
    await expect(
      verifyPaymentResult({ kind: 'order', id: 'o-1' }, request),
    ).resolves.toBe('declined');
  });

  it('is error on a non-ok response — an unknown state, not a decline', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(okJson({ message: 'Payment verification failed' }, 400));
    await expect(
      verifyPaymentResult({ kind: 'order', id: 'o-1' }, request),
    ).resolves.toBe('error');
  });

  it('is error (not declined) when the network throws', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      verifyPaymentResult({ kind: 'transaction', id: 't-1' }, request),
    ).resolves.toBe('error');
  });
});

describe('which cart lines a paid order clears', () => {
  const order = {
    lineItems: [
      { listingId: 'l-1', listing: { id: 'l-1' } },
      { listingId: undefined, listing: { id: 'l-2' } },
      { listingId: 'l-1', listing: { id: 'l-1' } },
    ],
  } as never;

  it('uses the checkout marker snapshot first', () => {
    expect(orderCartListingIds(order, ['l-9', 'l-9'])).toEqual(['l-9']);
  });

  it('falls back to the order’s own lines, deduped', () => {
    expect(orderCartListingIds(order, null)).toEqual(['l-1', 'l-2']);
  });

  it('is empty when neither source identifies a line', () => {
    expect(orderCartListingIds(null)).toEqual([]);
    expect(orderCartListingIds({ lineItems: [] } as never, [])).toEqual([]);
  });
});
