// ─── Seller failure charge policy (operator 2026-10-27) ──────────────
//
// A seller who takes a buyer's money and then does not deliver costs the
// platform real money: the buyer is refunded IN FULL, so the gateway fee
// already paid is not recovered, and any courier waybill already booked is
// committed (Bob Go has no cancel API).
//
// The charge recovers exactly that out-of-pocket loss and nothing else:
//
//   4% of the amount actually refunded  — the payment-gateway round trip
//   + the carrier rate                 — only when a waybill was booked
//
// It is deliberately NOT the Platform Fee. The fee is refunded to the
// buyer, so docking it from the seller would be recovering lost margin,
// not a cost — a penalty, not an indemnity. Cost recovery is the version
// that survives the Conventional Penalties Act and CPA s48/s51.
//
// The rate is a pre-estimate: the codebase does not model Ozow's fee. If
// the real settlement fee differs, true it up here rather than at each
// call site.

import type { SellerChargeKind } from '@prisma/client';
import { consequencesForSaleReject } from './seller-reject-policy';

/** The gateway slice recovered on every seller-fault refund. */
export const SELLER_FAILURE_HANDLING_RATE = 0.04;

/**
 * Pure handling slice. `refundedTotalCents` is the CUMULATIVE amount
 * refunded on the sale, not this operation's slice — so a second partial
 * refund recomputes the same 4% of the new total instead of stacking
 * rounded slices, and a retried call is idempotent.
 */
export function sellerFailureHandlingCents(refundedTotalCents: number): number {
  const base = Math.max(0, Math.round(refundedTotalCents));
  return Math.max(0, Math.round(base * SELLER_FAILURE_HANDLING_RATE));
}

/**
 * The carrier slice. Charged only when a waybill exists (committed charge)
 * AND the failure is a non-delivery: a delivered-but-disputed item still
 * paid the carrier for a completed delivery, so billing shipping there
 * would over-recover.
 */
export function sellerFailureShippingCents(args: {
  kind: SellerChargeKind;
  shipmentCommitted: boolean;
  shippingCost: number | null | undefined;
}): number {
  if (!args.shipmentCommitted) return 0;
  if (!SHIPPING_WASTED.has(args.kind)) return 0;
  return Math.max(0, Math.round(args.shippingCost ?? 0));
}

const SHIPPING_WASTED: ReadonlySet<SellerChargeKind> = new Set([
  'SELLER_CANCELLED',
  'NO_DISPATCH',
  'NOT_DELIVERED',
  'DEALER_TRANSFER_FAILED',
]);

export interface SellerFailureCharge {
  handlingCents: number;
  shippingCents: number;
  amountCents: number;
}

export function sellerFailureChargeCents(args: {
  kind: SellerChargeKind;
  refundedTotalCents: number;
  shipmentCommitted: boolean;
  shippingCost: number | null | undefined;
}): SellerFailureCharge {
  const handlingCents = sellerFailureHandlingCents(args.refundedTotalCents);
  const shippingCents = sellerFailureShippingCents(args);
  return {
    handlingCents,
    shippingCents,
    amountCents: handlingCents + shippingCents,
  };
}

/**
 * Whether a paid-sale rejection earns a charge.
 *
 * Reuses the strike matrix: if the reason does not earn a strike, the
 * seller isn't at fault (the one case today is BUYER_SUSPICIOUS, which
 * routes to trust review instead), so they must not be billed for it.
 * `reason` is the CODE the picker sends (`STOCK_ISSUE`, `SOLD_ELSEWHERE`…).
 */
export function sellerPaysForSaleReject(reason: string): boolean {
  return consequencesForSaleReject(reason).includes('STRIKE');
}

/** Reasons the admin refund dialog may attach to a seller charge. */
export const SELLER_CHARGE_REASONS: {
  value: SellerChargeKind;
  label: string;
}[] = [
  { value: 'SELLER_CANCELLED', label: 'Seller declined or cancelled the sale' },
  { value: 'NO_DISPATCH', label: 'Seller never dispatched' },
  { value: 'NOT_DELIVERED', label: 'Item never delivered' },
  {
    value: 'DEALER_TRANSFER_FAILED',
    label: 'Dealer transfer was never completed',
  },
];
