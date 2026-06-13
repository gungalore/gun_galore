import { Injectable } from '@nestjs/common';

// Commission bands — ZAR cents. Tax-bracket style: each band's `limit`
// is the WIDTH of the slice (not a cumulative cap), so the marginal
// rate only applies to the rand that fall inside that slice.
//
// Reduced 2026-05-20: every band dropped by 1 percentage point and a
// R30 minimum platform fee added (see MIN_COMMISSION_CENTS below). The
// minimum protects the platform on small-ticket sales — a R50 item at
// 9% is only R4.50, which doesn't cover the processing overhead.
export const BANDS: { limit: number; rate: number; label: string }[] = [
  { limit: 500_000, rate: 0.09, label: 'First R5,000 at 9%' },
  { limit: 1_500_000, rate: 0.07, label: 'R5,001–R20,000 at 7%' },
  { limit: 8_000_000, rate: 0.05, label: 'R20,001–R100,000 at 5%' },
  { limit: Infinity, rate: 0.03, label: 'Above R100,000 at 3%' },
];

// Floor on platform commission. The bands above are applied first, then
// the result is bumped up to MIN_COMMISSION_CENTS if it falls below.
// Surfaced to the seller in the Sell form so there are no surprises.
export const MIN_COMMISSION_CENTS = 3_000; // R30

// Top Seller discount — 0.5% off total price. LOCKED per CLAUDE.md.
const TOP_SELLER_DISCOUNT = 0.005;

// Card-gateway processing fee (Stitch/Peach lineage). Published rate is
// 3.5% + R1.50 fixed, VAT-EXCLUSIVE. SA VAT is 15%, so the buyer-facing
// inclusive figure is (subtotal × 3.5% + R1.50) × 1.15 ≈ 4.025% + R1.725.
// Computed inclusively so the buyer sees the figure billed against the card.
const PEACH_RATE = 0.035;
const PEACH_FIXED_CENTS = 150; // R1.50
const VAT_MULTIPLIER = 1.15; // SA VAT — 15% on top of the net card fee

// Manual EFT processing fee. While there is no card gateway, buyers pay
// GG by bank EFT and a flat 1.5% handling fee is added to the order (no
// fixed component). Operator decision 2026-06: manual mode = 1.5%, the
// dormant paygate keeps the 3.5%+R1.50 card rate.
const MANUAL_RATE = 0.015;

// Which fee schedule to apply. 'paygate' = card gateway rate (default,
// keeps every existing caller unchanged); 'manual' = flat 1.5% EFT fee.
export type PaymentMode = 'paygate' | 'manual';

export interface FeeBreakdown {
  listingPrice: number;   // ZAR cents
  shippingCost: number;   // ZAR cents — courier rate at checkout time
  commissionZar: number;  // ZAR cents — platform commission off the listing price only
  processingFee: number;  // ZAR cents — gateway/EFT fee, charged on (listing + shipping)
  buyerTotal: number;     // ZAR cents — what the buyer pays
  sellerPayout: number;   // ZAR cents — what the seller actually receives
}

@Injectable()
export class FeeCalculator {
  calculateCommission(priceZarCents: number, isTopSeller: boolean): number {
    let commission = 0;
    let remaining = priceZarCents;

    for (const band of BANDS) {
      if (remaining <= 0) break;
      const chunk = isFinite(band.limit)
        ? Math.min(remaining, band.limit)
        : remaining;
      commission += chunk * band.rate;
      remaining -= chunk;
    }

    if (isTopSeller) {
      commission -= priceZarCents * TOP_SELLER_DISCOUNT;
    }

    // R30 minimum platform fee — kicks in on low-ticket sales where the
    // band rate alone would leave us underwater on processing. Skipped
    // when there's no sale to begin with (priceZarCents === 0).
    const rounded = Math.max(0, Math.round(commission));
    if (priceZarCents > 0 && rounded < MIN_COMMISSION_CENTS) {
      // Don't let the minimum exceed the price itself — that would mean
      // the seller pays us more than the buyer paid them.
      return Math.min(MIN_COMMISSION_CENTS, priceZarCents);
    }
    return rounded;
  }

  /**
   * Processing fee on a given subtotal (listing price + shipping).
   * - 'paygate': card rate, VAT-inclusive — (base × 3.5% + R1.50) × 1.15.
   * - 'manual': flat 1.5% EFT handling fee, no fixed component.
   */
  calculateProcessingFee(baseZarCents: number, mode: PaymentMode = 'paygate'): number {
    if (mode === 'manual') {
      return Math.round(baseZarCents * MANUAL_RATE);
    }
    const net = baseZarCents * PEACH_RATE + PEACH_FIXED_CENTS;
    return Math.round(net * VAT_MULTIPLIER);
  }

  /**
   * Full breakdown. `shippingCost` is the Pudo / TCG quote at checkout
   * time, paid by the buyer on top of the listing price (per house
   * standard — shipping is always passed to the buyer for marketplace
   * sales). Zero for firearm DEALER_TRANSFER / PRIVATE_ARRANGE since
   * those don't use the courier API.
   */
  breakdown(
    listingPriceZarCents: number,
    passFeeToBuyer: boolean,
    isTopSeller: boolean,
    shippingCostZarCents = 0,
    mode: PaymentMode = 'paygate',
  ): FeeBreakdown {
    const listingPrice = listingPriceZarCents;
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const commissionZar = this.calculateCommission(listingPrice, isTopSeller);
    // The processing fee is charged on whatever the buyer actually pays,
    // which always includes shipping. Don't strip shipping out of the
    // base or we under-collect. Mode selects card (3.5%+R1.50) vs the
    // manual EFT flat 1.5%.
    const processingFee = this.calculateProcessingFee(
      listingPrice + shippingCost,
      mode,
    );

    // If buyer absorbs fee: buyer pays price + shipping + fee,
    //                       seller receives price - commission
    // If seller absorbs fee: buyer pays price + shipping,
    //                        seller receives price - commission - fee
    const buyerTotal = passFeeToBuyer
      ? listingPrice + shippingCost + processingFee
      : listingPrice + shippingCost;
    const sellerPayout = passFeeToBuyer
      ? listingPrice - commissionZar
      : listingPrice - commissionZar - processingFee;

    return {
      listingPrice,
      shippingCost,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout: Math.max(0, sellerPayout),
    };
  }
}
