import { ServiceUnavailableException } from '@nestjs/common';

// ─── Payment-mode seam (standalone, dependency-free) ──────────────────
//
// Extracted from transactions.service so lightweight consumers (e.g. the
// featured-slot service) can read the payment rail + gate WITHOUT dragging
// in the whole transactions → shipping → search (meilisearch) module graph.
// transactions.service re-exports these for backward compatibility, so
// every existing importer keeps working unchanged.

// Payment mode. The seam that drives fee maths (flat EFT-style fee vs gateway
// rate) and the refund-owed arms (a card gateway — Ozow — reverses on the
// original payment; otherwise GG owes the money out of its account). The
// pay-in rail is Ozow One API; 'paygate' selects the gateway-rate fee +
// gateway-reversal refund arm. Defaults to 'manual' so the fee/refund maths
// keep their pre-paygate shape until the operator flips PAYMENT_MODE=paygate.
export const PAYMENT_MODE: 'manual' | 'paygate' =
  process.env.PAYMENT_MODE === 'paygate' ? 'paygate' : 'manual';

// ── Phase-1 payment gate (manual EFT retired) ──────────────────────────
// Buyer manual-EFT pay-in has been removed. The card paygate is not live
// until it is integrated + TPPP-approved, so until PAYMENTS_LIVE=true every
// checkout entry point returns "card payments launching soon" instead of a
// payment path. The money-state / accounting engine is unchanged and
// rail-agnostic — only the entry gate changes. (Env PAYMENTS_LIVE=true flips
// it on at paygate cutover.)
export const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === 'true';

export function assertPaymentsLive(): void {
  if (!PAYMENTS_LIVE) {
    throw new ServiceUnavailableException(
      'Card payments are launching soon — you can browse and list in the meantime.',
    );
  }
}

// ── Cart-checkout switch (separate from PAYMENTS_LIVE) ─────────────────
// createOrderCheckout reserves EVERY line and creates an AWAITING_PAYMENT
// Order, but no Ozow payment is ever created for an order and the frontend
// does nothing on a successful response. With PAYMENTS_LIVE=true (production)
// the old single-item gate no longer fires, so a cart checkout would leak N
// reserved listings + a dead Order on every attempt. Until the cart paygate is
// actually wired (payment created + frontend hand-off), this is a hard
// off-switch. Flip CART_CHECKOUT_LIVE=true only when that lands.
export const CART_CHECKOUT_LIVE = process.env.CART_CHECKOUT_LIVE === 'true';

export function assertCartCheckoutLive(): void {
  if (!CART_CHECKOUT_LIVE) {
    throw new ServiceUnavailableException(
      'Cart checkout is coming soon — please buy items one at a time for now.',
    );
  }
}
