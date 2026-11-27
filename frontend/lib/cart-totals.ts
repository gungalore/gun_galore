// ────────────────────────────────────────────────────────────────────
// THE CART'S MONEY — ONE PLATFORM FEE FOR THE WHOLE BASKET.
//
// Operator decision, 2026-11-27: the Platform Fee is charged ONCE on the whole
// cart, on base = items subtotal + delivery. It is NOT once per item and NOT
// once per seller group. The old cart summed a per-line fee, which is the bug
// this module exists to make impossible: every total on the cart page comes
// from here, and the backend charges the same shape (order-fee.ts).
//
// ⚠️ THE FEE SCHEDULE LIVES IN lib/platform-fee.ts, not here. This module only
// decides WHAT BASE to price. A second copy of the bands would drift — the
// build gate (scripts/fee-sync.cjs) checks platform-fee.ts against the backend,
// so a number written here would be invisible to it.
//
// Pure and I/O-free: the page supplies the subtotals, so every branch (empty
// cart, fee floor, multiple seller groups) is unit-tested without a DOM.
// ────────────────────────────────────────────────────────────────────

import { platformFeeCents } from './platform-fee';

export interface CartTotals {
  /** Σ(unit price × quantity) across every line, ZAR cents. */
  itemsSubtotalCents: number;
  /** Σ chosen courier prices — one per seller accessories group. */
  shippingCents: number;
  /** The ONE Platform Fee: bands + R10 floor, applied to the whole base. */
  platformFeeCents: number;
  /** What the buyer pays: items + delivery + platform fee. */
  totalCents: number;
}

/** Non-negative whole cents from untrusted API/localStorage input. */
export function wholeCents(value: number | null | undefined): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Line subtotal for one cart line (unit price × units). */
export function cartLineSubtotalCents(item: {
  price: number;
  quantity?: number;
}): number {
  const units = Math.max(1, Math.floor(Number(item.quantity ?? 1)) || 1);
  return wholeCents(item.price) * units;
}

/** Items subtotal across the whole cart, in cents. */
export function cartItemsSubtotalCents(
  items: ReadonlyArray<{ price: number; quantity?: number }>,
): number {
  return items.reduce((sum, item) => sum + cartLineSubtotalCents(item), 0);
}

/**
 * The whole-cart totals. `shippingCents` is the sum of the chosen courier
 * quotes (one row per seller accessories group) — private and firearm groups
 * contribute nothing because they are handed over, not shipped. An empty cart
 * is all zeros, never a lone R10 floor.
 */
export function cartTotals(
  itemsSubtotalCents: number,
  shippingCents = 0,
): CartTotals {
  const items = wholeCents(itemsSubtotalCents);
  const shipping = wholeCents(shippingCents);
  const base = items + shipping;
  // platformFeeCents(0) is already 0 (the floor is capped at the base), but
  // being explicit keeps an empty cart's payload shaped like every other.
  const fee = base > 0 ? platformFeeCents(base) : 0;
  return {
    itemsSubtotalCents: items,
    shippingCents: shipping,
    platformFeeCents: fee,
    totalCents: items + shipping + fee,
  };
}

/** Convenience: totals straight from the cart lines + chosen delivery. */
export function cartTotalsForItems(
  items: ReadonlyArray<{ price: number; quantity?: number }>,
  shippingCents = 0,
): CartTotals {
  return cartTotals(cartItemsSubtotalCents(items), shippingCents);
}

/**
 * Totals after removing one line locally.
 *
 * Multi-item removal has to be instant on a cart with no pending order: drop
 * the line, then re-price the remainder. This helper keeps that arithmetic in
 * one tested place — the caller passes the shipping that still applies (the
 * removed line's seller group may have lost its only courier parcel, in which
 * case it drops to 0).
 */
export function cartTotalsAfterRemoval(
  items: ReadonlyArray<{ price: number; quantity?: number; listingId: string }>,
  removedListingId: string,
  remainingShippingCents: number,
): CartTotals & { remainingItems: number } {
  const remaining = items.filter(
    (item) => item.listingId !== removedListingId,
  );
  return {
    ...cartTotalsForItems(remaining, remainingShippingCents),
    remainingItems: remaining.length,
  };
}
