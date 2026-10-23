import { Injectable } from '@nestjs/common';

// Platform Fee bands — ZAR cents. Tax-bracket style: each band's `limit`
// is the WIDTH of the slice (not a cumulative cap), so the marginal
// rate only applies to the rand that fall inside that slice.
//
// Operator decision 2026-10: widened to 10 / 9 / 8 / 7 across R25,000
// slices, with 7% running to Infinity. The R10 minimum still protects
// small-ticket sales — 10% of a R50 item is R5, below the floor.
export const BANDS: { limit: number; rate: number; label: string }[] = [
  { limit: 2_500_000, rate: 0.10, label: 'First R25,000 at 10%' },
  { limit: 2_500_000, rate: 0.09, label: 'R25,001–R50,000 at 9%' },
  { limit: 2_500_000, rate: 0.08, label: 'R50,001–R75,000 at 8%' },
  { limit: Infinity, rate: 0.07, label: 'Above R75,000 at 7%' },
];

// Floor on the platform fee. The bands above are applied first, then the
// result is bumped up to MIN_COMMISSION_CENTS if it falls below. Surfaced
// to the buyer at checkout and to the seller in the Sell form.
export const MIN_COMMISSION_CENTS = 1_000; // R10

// Auctions carry ONE flat 10% platform charge, split evenly between the
// parties: the buyer pays 5% on (hammer + delivery), the seller pays 5%
// of the hammer price.
export const AUCTION_SPLIT_RATE = 0.05;

// Which fee schedule to apply. Kept so historical rows and callers still
// type-check; the old gateway-rate switch no longer changes the maths —
// the Platform Fee is the only buyer-side charge.
export type PaymentMode = 'paygate' | 'manual';

// P6.4 — GG shipping handling margin. RETIRED 2026-10-23.
//
// It used to add 10% of the carrier rate to the buyer's delivery figure, and
// that figure was then part of the Platform Fee base. Operator decision: the
// buyer pays the courier's live rate with no margin, and the Platform Fee is
// calculated on item + that rate. The rate is 0 and the helpers are kept so the
// historical Transaction.shippingHandlingCents column still reads correctly
// (old rows carry their margin; new rows are zero).
export const SHIPPING_HANDLING_RATE = 0;

/**
 * The delivery margin in cents. Always 0 for sales priced after 2026-10-23.
 *
 * Kept as a function so every caller passes the same number into the snapshot,
 * and so old rows can still be read with their original margin.
 */
export function shippingHandlingCentsFor(carrierRateCents: number): number {
  return Math.max(0, Math.round(Math.max(0, carrierRateCents) * SHIPPING_HANDLING_RATE));
}

/** What the buyer sees for delivery: the courier's live rate, no margin. */
export function displayShippingCents(carrierRateCents: number): number {
  const rate = Math.max(0, Math.round(carrierRateCents));
  return rate + shippingHandlingCentsFor(rate);
}

export interface FeeBreakdown {
  listingPrice: number;   // ZAR cents — the item price (raw seller ask / hammer)
  shippingCost: number;   // ZAR cents — courier rate at checkout time (remitted to carrier)
  shippingHandlingCents: number; // ZAR cents — legacy delivery margin (0 for sales after 2026-10-23; old rows keep theirs)
  commissionZar: number;  // ZAR cents — SELLER-paid platform commission (auction only)
  processingFee: number;  // ZAR cents — BUYER-paid Platform Fee (charged last on item + delivery)
  buyerTotal: number;     // ZAR cents — what the buyer pays
  sellerPayout: number;   // ZAR cents — what the seller actually receives
}

@Injectable()
export class FeeCalculator {
  /**
   * Marginal Platform Fee on a base amount (item + delivery).
   *
   * The R10 minimum is capped at the base itself so a corrupt row can never
   * charge more than the thing being sold.
   */
  calculatePlatformFee(baseZarCents: number): number {
    const base = Math.max(0, Math.round(baseZarCents));
    if (base === 0) return 0;

    let fee = 0;
    let remaining = base;
    for (const band of BANDS) {
      if (remaining <= 0) break;
      const chunk = isFinite(band.limit)
        ? Math.min(remaining, band.limit)
        : remaining;
      fee += chunk * band.rate;
      remaining -= chunk;
    }

    const rounded = Math.max(0, Math.round(fee));
    if (rounded < MIN_COMMISSION_CENTS) {
      return Math.min(MIN_COMMISSION_CENTS, base);
    }
    return rounded;
  }

  /**
   * The two halves of an auction's flat 10% platform charge.
   *
   * buyerFee  — 5% of (hammer + delivery), floored at R10 (capped at the base).
   * sellerFee — 5% of the hammer price, deducted from the seller's payout.
   */
  calculateAuctionFees(
    hammerZarCents: number,
    deliveryZarCents = 0,
  ): { buyerFee: number; sellerFee: number } {
    const hammer = Math.max(0, Math.round(hammerZarCents));
    const delivery = Math.max(0, Math.round(deliveryZarCents));
    if (hammer === 0) return { buyerFee: 0, sellerFee: 0 };

    const base = hammer + delivery;
    const rawBuyer = Math.round(base * AUCTION_SPLIT_RATE);
    const buyerFee =
      rawBuyer < MIN_COMMISSION_CENTS
        ? Math.min(MIN_COMMISSION_CENTS, base)
        : rawBuyer;
    const sellerFee = Math.round(hammer * AUCTION_SPLIT_RATE);
    return { buyerFee, sellerFee };
  }

  /**
   * BUY NOW — the seller asks for a number and receives exactly that.
   *
   * The listed price IS the seller's ask (operator 2026-10). The Platform Fee
   * is added at checkout on (item + delivery), so the seller never sees a
   * deduction and the buyer sees one explicit fee line.
   *
   *   ask                          R1,000   seller receives this
   *   + Platform Fee (banded)      R  100   our margin
   *   + delivery                   R   79   carrier + handling
   *   = BUYER TOTAL                R1,179
   */
  listPriceFromSellerAsk(sellerAskZarCents: number): {
    sellerAsk: number;
    commissionZar: number;
    listPrice: number;
  } {
    const sellerAsk = Math.max(0, Math.round(sellerAskZarCents));
    const commissionZar = this.calculatePlatformFee(sellerAsk);
    return {
      sellerAsk,
      // Estimated fee on the item alone — delivery is only known at checkout.
      commissionZar,
      // The seller's ask is the listed price; the fee is NOT baked in.
      listPrice: sellerAsk,
    };
  }

  /**
   * BUY NOW breakdown, from the seller's ask plus the delivery quote.
   *
   * The Platform Fee is calculated LAST, on the whole line (item × quantity)
   * plus the delivery figure (the courier's live rate; no margin since
   * 2026-10-23, legacy rows may still carry a handling value).
   * The seller receives their full ask; the buyer pays the fee.
   */
  breakdownBuyNow(
    sellerAskZarCents: number,
    shippingCostZarCents = 0,
    handlingFeeCents = 0,
    quantity = 1,
    _mode: PaymentMode = 'paygate',
  ): FeeBreakdown {
    const qty = Math.max(1, Math.round(quantity));
    const item = Math.max(0, Math.round(sellerAskZarCents)) * qty;
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));
    const delivery = shippingCost + shippingHandlingCents;
    // Calculated LAST: the fee base includes the delivery figure.
    const processingFee = this.calculatePlatformFee(item + delivery);

    return {
      listingPrice: item,
      shippingCost,
      shippingHandlingCents,
      // The seller pays no commission on a Buy Now sale.
      commissionZar: 0,
      processingFee,
      buyerTotal: item + delivery + processingFee,
      sellerPayout: item,
    };
  }

  /**
   * AUCTION (and an offer accepted on an auction) — flat 10% split 5/5.
   *
   * The buyer pays 5% of (hammer + delivery) at checkout; the seller pays 5%
   * of the hammer, deducted from their payout.
   */
  breakdownAuction(
    hammerZarCents: number,
    shippingCostZarCents = 0,
    handlingFeeCents = 0,
    _mode: PaymentMode = 'paygate',
  ): FeeBreakdown {
    const hammer = Math.max(0, Math.round(hammerZarCents));
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));
    const delivery = shippingCost + shippingHandlingCents;
    const { buyerFee, sellerFee } = this.calculateAuctionFees(hammer, delivery);

    return {
      listingPrice: hammer,
      shippingCost,
      shippingHandlingCents,
      commissionZar: sellerFee,
      processingFee: buyerFee,
      buyerTotal: hammer + delivery + buyerFee,
      sellerPayout: Math.max(0, hammer - sellerFee),
    };
  }
}
