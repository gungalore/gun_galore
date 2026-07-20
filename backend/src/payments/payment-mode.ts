import { ServiceUnavailableException } from '@nestjs/common';

// ─── Payment-mode seam (standalone, dependency-free) ──────────────────
//
// Extracted from transactions.service so lightweight consumers (e.g. the
// featured-slot service) can read the payment rail + gate WITHOUT dragging
// in the whole transactions → shipping → search (meilisearch) module graph.
// transactions.service re-exports these for backward compatibility, so
// every existing importer keeps working unchanged.

// Payment mode. Retained as the seam that drives fee maths (flat EFT-style
// fee vs card rate) and the refund-owed arms (a card gateway reverses on the
// card; otherwise GG owes the money out of its account). The manual-EFT
// buyer pay-in rail itself has been removed — checkout is gated by
// assertPaymentsLive() until a card paygate is integrated. Defaults to
// 'manual' so the fee/refund maths keep their pre-paygate shape.
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
