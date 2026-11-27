// ────────────────────────────────────────────────────────────────────
// REMOVING A LINE FROM AN UNPAID ORDER (backend-owned).
//
// Once checkout has created an order, the lines are RESERVED by the backend:
// the cart can no longer just delete a line locally or the reservation and the
// order total would disagree. The removal call releases the line, re-prices the
// remaining seller groups and the ONE Platform Fee, and mints a NEW payment
// session for the new total.
//
// Pure request/response mapping with an INJECTED request function, so the
// cart and order pages share one implementation and the whole contract
// (removed / last-line cancelled / already-paid / error) is unit-tested with a
// mocked fetch.
// ────────────────────────────────────────────────────────────────────

import type { OrderDetail } from './order-page';

export type OrderLineRemoval =
  | {
      kind: 'removed';
      /** The order as the backend re-priced it. */
      order: OrderDetail;
      /** New gateway session for the NEW total (present when the rail is live). */
      redirectUrl?: string;
      paymentId?: string;
    }
  /** Removing the last line cancelled the order; the cart empties. */
  | { kind: 'cancelled' }
  /** A capture landed — lines can no longer be removed (409). */
  | { kind: 'paid'; message: string }
  | { kind: 'error'; message: string };

function messageOf(value: unknown, fallback: string): string {
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === 'string');
    if (parts.length) return parts.join(', ');
  }
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/**
 * DELETE one line from an unpaid order.
 *
 * `request(path, init)` is the caller's authenticated fetch against the API
 * base — every page already has one, and injecting it keeps this module pure.
 */
export async function removeOrderLine(options: {
  orderId: string;
  transactionId: string;
  request: (path: string, init: RequestInit) => Promise<Response>;
}): Promise<OrderLineRemoval> {
  try {
    const res = await options.request(
      `/orders/${encodeURIComponent(options.orderId)}/lines/${encodeURIComponent(options.transactionId)}`,
      { method: 'DELETE' },
    );
    const data = (await res.json().catch(() => ({}))) as {
      cancelled?: boolean;
      order?: OrderDetail | null;
      payment?: { redirectUrl?: string; paymentId?: string };
      message?: string | string[];
    };
    if (res.status === 409) {
      return {
        kind: 'paid',
        message: messageOf(
          data.message,
          'This order has already been paid — lines can no longer be removed.',
        ),
      };
    }
    if (!res.ok) {
      return {
        kind: 'error',
        message: messageOf(data.message, 'Could not remove that item.'),
      };
    }
    const order = data.order ?? null;
    const cancelled =
      data.cancelled === true ||
      order?.status === 'CANCELLED' ||
      (order != null && (order.lineItems ?? []).length === 0);
    if (cancelled) return { kind: 'cancelled' };
    if (!order) {
      return {
        kind: 'error',
        message: 'The updated order could not be read. Refresh and try again.',
      };
    }
    const redirectUrl = data.payment?.redirectUrl;
    return {
      kind: 'removed',
      order,
      ...(redirectUrl ? { redirectUrl } : {}),
      ...(data.payment?.paymentId ? { paymentId: data.payment.paymentId } : {}),
    };
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach the server. Please try again.',
    };
  }
}
