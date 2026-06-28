'use client';

import { useEffect, useState } from 'react';

// Phase 8b cart — client-only, localStorage-backed. A cart is SINGLE-SELLER
// (every line from one seller) so it maps to exactly one Order with one EFT
// reference. Firearms / auctions / take-a-shot never enter the cart (the
// Add-to-cart button is only rendered for ACTIVE BUY_NOW non-firearm listings).

export interface CartItem {
  listingId: string;
  title: string;
  price: number; // ZAR cents (unit price snapshot)
  imageUrl?: string;
  sellerId: string; // clerkId of the seller — the single-seller key
  sellerUsername: string;
}

const KEY = 'gg:cart';
const EVENT = 'gg:cart-changed';

function read(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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

export type AddResult =
  | { status: 'added' }
  | { status: 'exists' }
  | { status: 'seller-conflict'; currentSeller: string };

/**
 * Add an item. Enforces the single-seller invariant: adding from a different
 * seller returns 'seller-conflict' (the UI prompts replace-or-cancel) rather
 * than silently mixing sellers. A listing already in the cart is a no-op
 * ('exists') — quantity-per-line is chosen at the cart, not by re-adding.
 */
export function addToCart(item: CartItem): AddResult {
  const items = read();
  if (items.some((i) => i.listingId === item.listingId)) {
    return { status: 'exists' };
  }
  if (items.length > 0 && items[0].sellerId !== item.sellerId) {
    return { status: 'seller-conflict', currentSeller: items[0].sellerUsername };
  }
  write([...items, item]);
  return { status: 'added' };
}

/** Discard the current cart and start a fresh one with this single item. */
export function replaceCart(item: CartItem) {
  write([item]);
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
