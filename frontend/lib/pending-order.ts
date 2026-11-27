// ────────────────────────────────────────────────────────────────────
// THE UNPAID ORDER MARKER.
//
// When `POST /orders/checkout` succeeds the buyer is handed to the hosted
// payment page. That round-trip can leave our origin (Ozow/Peach), and the
// gateway returns to the COMPLETE URL without necessarily echoing our order
// id. This marker is how the complete page and the cart find the order again:
//
//   • /checkout/complete?orderId=… verifies it (query param wins);
//   • /cart knows an unpaid order exists, so Remove must go through the
//     backend removal endpoint instead of a local delete;
//   • a successful verify / paid order clears it.
//
// ⚠️ THE LISTING IDS RIDE ALONG. Clearing the cart after payment must remove
// exactly the lines this order bought — not whatever happens to be in the cart
// later, and not the whole cart (the buyer may have added something else while
// paying). They are a best-effort snapshot: if absent, the complete page falls
// back to reading the order's own lineItems.
//
// Plain localStorage, best-effort everywhere: storage-disabled browsers still
// settle server-side (the webhook/reconcile path), they just lose the UI hint.
// ────────────────────────────────────────────────────────────────────

const PENDING_ORDER_KEY = 'gg:pendingOrder';

export interface PendingOrder {
  orderId: string;
  /** Listing ids the order was created with, for clearing the cart on pay. */
  listingIds?: string[];
}

function isPendingOrder(value: unknown): value is PendingOrder {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.orderId !== 'string' || !record.orderId) return false;
  if (record.listingIds !== undefined) {
    if (!Array.isArray(record.listingIds)) return false;
    if (
      record.listingIds.some(
        (id) => typeof id !== 'string' || id.length === 0,
      )
    ) {
      return false;
    }
  }
  return true;
}

/** The live unpaid-order marker, or null. Safe on the server. */
export function getPendingOrder(): PendingOrder | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingOrder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remember the order the buyer was just handed to the gateway for. */
export function setPendingOrder(order: PendingOrder): void {
  if (typeof window === 'undefined') return;
  if (!order?.orderId) return;
  try {
    window.localStorage.setItem(
      PENDING_ORDER_KEY,
      JSON.stringify({
        orderId: order.orderId,
        ...(order.listingIds?.length
          ? { listingIds: [...new Set(order.listingIds.filter(Boolean))] }
          : {}),
      }),
    );
  } catch {
    /* private mode / quota — the verify path still works from the URL */
  }
}

/** Drop the marker (payment settled, order cancelled, or the order is gone). */
export function clearPendingOrder(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    /* best effort */
  }
}

/** Refresh the listing ids on an existing marker, keeping its order id. */
export function syncPendingOrderListingIds(listingIds: string[]): void {
  const current = getPendingOrder();
  if (!current) return;
  setPendingOrder({ orderId: current.orderId, listingIds });
}
