// ────────────────────────────────────────────────────────────────────
// ORDER STATUS — ONE VOCABULARY FOR /my/orders AND /orders/[id].
//
// The Order model has its own status enum, distinct from the per-line
// Transaction.paymentStatus. Multi-item checkout now surfaces ORDERS (one
// payment for the whole cart) instead of one row per transaction, so the buyer
// needs one label per order — and the two order surfaces must agree.
//
// The tone vocabulary and fallback behaviour are the shared ones in
// lib/status-labels.ts; this module only owns the ORDER_STATUS table and the
// tiny action predicates the order surfaces share.
// ────────────────────────────────────────────────────────────────────

import { resolveStatus, type StatusEntry } from './status-labels';

/** OrderStatus (backend enum) → member-facing label. */
export const ORDER_STATUS: Record<string, StatusEntry> = {
  AWAITING_PAYMENT: {
    label: 'Awaiting payment',
    tone: 'pending',
    hint: 'Your payment has not been confirmed yet. Resume it from the order page — do not pay again.',
  },
  PAID: {
    label: 'Paid',
    tone: 'success',
    hint: 'Paid and protected. Your sellers are paid once each item is delivered or handed over.',
  },
  PARTIALLY_FULFILLED: {
    label: 'Partly delivered',
    tone: 'pending',
    hint: 'Some items in this order have been delivered — the rest are still on the way.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'success',
    hint: 'Every item in this order has been delivered or handed over.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    hint: 'This order was cancelled. Any reserved items were returned to sale.',
  },
  REFUNDED: {
    label: 'Refunded',
    tone: 'neutral',
    hint: 'This order was refunded.',
  },
};

/** Resolve an order status with the shared humanising fallback. */
export function orderStatusEntry(
  status: string | null | undefined,
): StatusEntry {
  return resolveStatus(ORDER_STATUS, status);
}

/** Unpaid, still-payable (or resumable) — the only removable/cancellable state. */
export function orderIsUnpaid(status: string | null | undefined): boolean {
  return status === 'AWAITING_PAYMENT';
}

/**
 * Money has been captured for this order. Once paid there is no removal of a
 * line: the buyer cancels/refunds through support, and the service refuses a
 * line delete with a 409.
 */
export function orderIsPaid(status: string | null | undefined): boolean {
  return (
    status === 'PAID' ||
    status === 'PARTIALLY_FULFILLED' ||
    status === 'COMPLETED' ||
    status === 'REFUNDED'
  );
}

/** Partly delivered — the mid-flight paid state that needs a status word. */
export function orderIsPartiallyFulfilled(
  status: string | null | undefined,
): boolean {
  return status === 'PARTIALLY_FULFILLED';
}

/**
 * Whether the order page should offer Remove. Backend `canRemove` wins when it
 * is present (single source of truth); the status fallback keeps the UI honest
 * against an older payload that predates the field.
 */
export function orderCanRemoveLines(order: {
  status?: string | null;
  canRemove?: boolean;
}): boolean {
  if (typeof order.canRemove === 'boolean') return order.canRemove;
  return orderIsUnpaid(order.status);
}

/** Whether the buyer can restart/resume the single order payment. */
export function orderCanResumePayment(order: {
  status?: string | null;
}): boolean {
  return orderIsUnpaid(order.status);
}

/** Whether the buyer can cancel the whole unpaid order. */
export function orderCanCancel(order: { status?: string | null }): boolean {
  return orderIsUnpaid(order.status);
}
