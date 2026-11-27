// ────────────────────────────────────────────────────────────────────
// THE RETURN-FROM-GATEWAY VERIFY PATH.
//
// /checkout/complete serves TWO rails and must pick the right one: the legacy
// single-item TRANSACTION verify and the multi-item ORDER verify. Which one it
// is depends on the query string the gateway echoes, with the localStorage
// markers as the fallback (some gateways return to the registered base URL
// with no id at all).
//
// Pure + injected I/O, so the whole decision and the response interpretation
// are unit-tested without a page render (vitest does not include app/**).
// ────────────────────────────────────────────────────────────────────

import type { OrderDetail } from './order-page';
export type VerifyResult = 'ok' | 'declined' | 'error';

export type VerifyTarget =
  | { kind: 'order'; id: string }
  | { kind: 'transaction'; id: string };

/**
 * Resolve what to verify.
 *
 * Precedence: an explicit ORDER id (query, then marker) before a transaction
 * id — a cart hand-off that somehow carries both must verify the order it was
 * handed to the gateway for. Query params win over stored markers because a
 * shared/bookmarked return URL is the more recent truth.
 */
export function resolveVerifyTarget(input: {
  orderId?: string | null;
  transactionId?: string | null;
  pendingOrderId?: string | null;
  pendingTransactionId?: string | null;
}): VerifyTarget | null {
  const clean = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  const orderId = clean(input.orderId) ?? clean(input.pendingOrderId);
  if (orderId) return { kind: 'order', id: orderId };
  const transactionId =
    clean(input.transactionId) ?? clean(input.pendingTransactionId);
  if (transactionId) return { kind: 'transaction', id: transactionId };
  return null;
}

/** API path (relative to the API base) for the verify call. */
export function verifyPathFor(target: VerifyTarget): string {
  return target.kind === 'order'
    ? `/orders/${encodeURIComponent(target.id)}/verify-result`
    : `/transactions/${encodeURIComponent(target.id)}/verify-result`;
}

/** Where the success/error screens send the buyer afterwards. */
export function destinationFor(target: VerifyTarget): string {
  return target.kind === 'order'
    ? `/orders/${encodeURIComponent(target.id)}`
    : `/transactions/${encodeURIComponent(target.id)}`;
}

/**
 * Ask the backend whether the payment settled.
 *
 * ⚠️ GATE ON THE BODY FLAG, NEVER ON res.ok. The endpoint returns 200 for BOTH
 * success and "not captured yet" ({ success: false }); reading res.ok would
 * paint "Payment successful" on an unpaid order (and the buyer would stop
 * trying). A thrown/network failure is 'error' — an UNKNOWN state, never
 * "declined", so the copy never tells a charged buyer they weren't.
 */
export async function verifyPaymentResult(
  target: VerifyTarget,
  request: (
    path: string,
    init: RequestInit,
  ) => Promise<Response>,
): Promise<VerifyResult> {
  try {
    const res = await request(verifyPathFor(target), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      alreadyProcessed?: boolean;
    };
    if (res.ok && body.success === true) return 'ok';
    if (res.ok && body.success === false) return 'declined';
    return 'error';
  } catch {
    return 'error';
  }
}

/**
 * The cart lines this purchase clears.
 *
 * The checkout marker's listing snapshot is authoritative (it was captured at
 * checkout); the order's own lineItems are the fallback for a browser that
 * lost the snapshot. Duplicates are collapsed so a sync can never re-remove
 * stale ids.
 */
export function orderCartListingIds(
  order:
    | {
        lineItems?:
          | Array<{
              listingId?: string;
              listing?: { id?: string } | null;
            }>
          | null;
      }
    | null
    | undefined,
  markerListingIds?: string[] | null,
): string[] {
  const fromMarker = (markerListingIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (fromMarker.length > 0) return [...new Set(fromMarker)];
  const fromOrder = (order?.lineItems ?? [])
    .map((line) => line.listingId ?? line.listing?.id ?? '')
    .filter((id): id is string => Boolean(id));
  return [...new Set(fromOrder)];
}
