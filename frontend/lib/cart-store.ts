'use client';

import { useEffect, useState } from 'react';
import { trackCartAdd } from './activity-beacon';

// Phase 8b/8d cart — client-only, localStorage-backed. A cart may span
// MULTIPLE sellers (Phase 8d): it maps to ONE Order + one buyer EFT, which
// the backend fans out to a per-listing transaction so each seller is paid
// independently. Firearm BUY_NOW listings MAY now be added to the cart — at
// checkout they branch to a dealer-transfer or in-person route (never courier)
// and carry the 18+ attestation + route consent. Auctions / take-a-shot still
// never enter the cart (the Add-to-cart button is only rendered for ACTIVE
// BUY_NOW listings).

export interface CartItem {
  listingId: string;
  title: string;
  price: number; // ZAR cents (unit price snapshot)
  imageUrl?: string;
  sellerId: string; // clerkId of the seller — the single-seller key
  sellerUsername: string;
  // Firearm lines branch to dealer/in-person routing in the cart instead of
  // courier. Defaults false for legacy cart rows written before this field.
  isFirearm: boolean;
  // The shipping routes the seller offered on the listing. For firearms this
  // is the subset of [DEALER_TRANSFER, PRIVATE_ARRANGE] the cart offers the
  // buyer as a route toggle.
  shippingMethods: string[];
  // Units of this listing on the line. OPTIONAL on the way IN because every
  // Add-to-cart caller omits it and every cart row written before this shipped
  // has no such key — read() normalises a missing/garbage value to 1, so
  // anything coming OUT of getCart()/useCart() always carries a whole number
  // >= 1. Only an inventory-tracked (Listing.trackInventory) non-firearm line
  // can go above 1: /cart clamps the stepper to the listing's live sellable
  // count and the backend re-checks the counter atomically at checkout
  // (resolvePurchaseQuantity + the conditional reserve), so a stale cart can
  // never over-sell.
  quantity?: number;
}

const KEY = 'gg:cart';
const EVENT = 'gg:cart-changed';

// Sanity ceiling only — the REAL ceiling is the listing's sellable stock,
// which the cart page reads live. This just stops a hand-edited localStorage
// (or a fat-fingered 9999) producing an absurd line before the server says no.
const MAX_LINE_QUANTITY = 99;

/** Coerce any stored/typed quantity to a whole number in [1, MAX_LINE_QUANTITY]. */
function normaliseQuantity(q: unknown): number {
  const n = Math.floor(Number(q));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_LINE_QUANTITY);
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Normalise quantity on the way out so no consumer has to repeat the
    // `?? 1` dance — legacy rows predate the field entirely.
    return (parsed as CartItem[]).map((i) => ({
      ...i,
      quantity: normaliseQuantity(i?.quantity),
    }));
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — cart is best-effort */
  }
  // Notify same-tab listeners (the storage event only fires cross-tab).
  window.dispatchEvent(new Event(EVENT));
}

export function getCart(): CartItem[] {
  return read();
}

export function cartSeller(): string | null {
  return read()[0]?.sellerId ?? null;
}

export type AddResult = { status: 'added' } | { status: 'exists' };

/**
 * Add an item. A cart may mix sellers (Phase 8d). A listing already in the
 * cart is a no-op ('exists') — there's one line per listing.
 */
export function addToCart(item: CartItem): AddResult {
  const items = read();
  if (items.some((i) => i.listingId === item.listingId)) {
    return { status: 'exists' };
  }
  write([...items, item]);
  void trackCartAdd(item.listingId); // insights beacon (fire-and-forget)
  return { status: 'added' };
}

/** Discard the current cart and start a fresh one with this single item. */
export function replaceCart(item: CartItem) {
  write([item]);
}

/**
 * Set the units on ONE cart line (Phase-8 per-line quantity).
 *
 * Clamped to >= 1 — stepping down never removes the line, because "Remove" is
 * a deliberate, separately-labelled action and a silent disappearing row is a
 * nasty surprise. The caller owns the STOCK ceiling (the cart page clamps to
 * the listing's live sellable count); this only enforces the shape.
 *
 * No-ops when the line is gone or already at that quantity, so a clamp pass
 * that re-asserts the same value can't loop the change event.
 */
export function setCartQuantity(listingId: string, quantity: number) {
  const items = read();
  const cur = items.find((i) => i.listingId === listingId);
  if (!cur) return;
  const next = normaliseQuantity(quantity);
  if (cur.quantity === next) return;
  write(
    items.map((i) =>
      i.listingId === listingId ? { ...i, quantity: next } : i,
    ),
  );
}

export function removeFromCart(listingId: string) {
  write(read().filter((i) => i.listingId !== listingId));
}

export function clearCart() {
  write([]);
}

/** Reactive cart hook — re-renders on any add/remove/clear (same tab + cross-tab). */
export function useCart(): CartItem[] {
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    const sync = () => setItems(read());
    sync(); // hydrate after mount (avoids SSR/client mismatch)
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return items;
}
