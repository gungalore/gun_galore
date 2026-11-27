// ────────────────────────────────────────────────────────────────────
// /my/orders — ONE ROW PER ORDER, NOT ONE PER TRANSACTION.
//
// Multi-item checkout means the buyer's list is now ORDERS: one payment, many
// lines across sellers. The old page fanned the order out into one card per
// child transaction, so a four-item cart looked like four separate purchases
// with four statuses — and nothing linked to the one page that can act on the
// payment as a whole (/orders/[id]).
//
// This module is the pure half: what each row says (status, item count, total,
// reference, preview) and how an untrusted `GET /orders` payload is read. The
// page stays a Server Component; there is no client state here to test.
// ────────────────────────────────────────────────────────────────────

import { orderItemCount, orderReference } from './order-page';
import { orderIsUnpaid, orderStatusEntry } from './order-status';
import type { StatusEntry } from './status-labels';

export interface OrderListLine {
  id?: string;
  /** Prisma scalar on OrderLineItem — present on every current payload. */
  sellerId?: string;
  listing?: {
    id?: string;
    title?: string;
    images?: { url: string }[] | null;
  } | null;
  quantity?: number;
}

export interface OrderListItem {
  id: string;
  status: string;
  orderReference?: string | null;
  itemsSubtotal?: number;
  shippingSubtotal?: number;
  handlingSubtotal?: number;
  processingFee?: number;
  buyerTotal?: number;
  createdAt?: string;
  lineItems?: OrderListLine[] | null;
}

/** The member-facing status for a list row. */
export function orderListStatus(order: OrderListItem): StatusEntry {
  return orderStatusEntry(order.status);
}

/** Units in the order (3 boxes on one line is 3 items). */
export function orderListUnitCount(order: OrderListItem): number {
  return orderItemCount(order);
}

/** Distinct sellers in the order — the "each seller ships separately" cue. */
export function orderListSellerCount(order: OrderListItem): number {
  const ids = new Set<string>();
  for (const line of order.lineItems ?? []) {
    if (line.sellerId) ids.add(line.sellerId);
  }
  return ids.size;
}

/** What the buyer paid / owes for the whole order. */
export function orderListTotalCents(order: OrderListItem): number {
  return Math.max(0, order.buyerTotal ?? 0);
}

/** The order reference shown to the buyer. */
export function orderListReference(order: OrderListItem): string {
  return orderReference(order);
}

/** True when this order is waiting on the buyer to finish paying. */
export function orderListNeedsPayment(order: OrderListItem): boolean {
  return orderIsUnpaid(order.status);
}

/** First line's title, with a compact "+N more" when the order has more. */
export function orderListPreviewTitle(order: OrderListItem): string {
  const lines = order.lineItems ?? [];
  const first = lines[0]?.listing?.title?.trim();
  if (!first) return 'Order';
  const extraLines = lines.length - 1;
  return extraLines > 0 ? `${first} +${extraLines} more` : first;
}

/** The thumbnail: the first line that has an image. */
export function orderListImageUrl(order: OrderListItem): string | null {
  for (const line of order.lineItems ?? []) {
    const url = line.listing?.images?.[0]?.url;
    if (url) return url;
  }
  return null;
}

/**
 * Read a `GET /orders` response defensively. A non-array body (an error
 * envelope, an empty 204) is an empty list, never a crash on a server render.
 */
export function parseOrderList(payload: unknown): OrderListItem[] {
  if (!Array.isArray(payload)) return [];
  const rows: OrderListItem[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id) continue;
    rows.push(record as unknown as OrderListItem);
  }
  return rows;
}
