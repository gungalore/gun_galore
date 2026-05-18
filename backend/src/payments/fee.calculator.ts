import { Injectable } from '@nestjs/common';

// Commission bands — ZAR cents. LOCKED per CLAUDE.md.
// Tax-bracket style: each band only applies to the slice within it.
const BANDS: { limit: number; rate: number }[] = [
  { limit: 500_000, rate: 0.10 },     // First R5,000 at 10%
  { limit: 1_500_000, rate: 0.08 },   // R5,001–R20,000 at 8%
  { limit: 8_000_000, rate: 0.06 },   // R20,001–R100,000 at 6%
  { limit: Infinity, rate: 0.04 },    // Above R100,000 at 4%
];

// Top Seller discount — 0.5% off total price. LOCKED per CLAUDE.md.
const TOP_SELLER_DISCOUNT = 0.005;

// Peach processing fee — confirm exact rates with Peach merchant agreement.
// Typical embedded checkout: 3.5% + R1.50 (VAT-exclusive).
// TODO: replace with confirmed Peach rates once merchant account is live.
const PEACH_RATE = 0.035;
const PEACH_FIXED_CENTS = 150; // R1.50

export interface FeeBreakdown {
  listingPrice: number;   // ZAR cents
  commissionZar: number;  // ZAR cents
  processingFee: number;  // ZAR cents
  buyerTotal: number;     // ZAR cents — what Peach charges
  sellerPayout: number;   // ZAR cents — what seller receives
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

    return Math.max(0, Math.round(commission));
  }

  calculateProcessingFee(baseZarCents: number): number {
    return Math.round(baseZarCents * PEACH_RATE) + PEACH_FIXED_CENTS;
  }

  breakdown(
    listingPriceZarCents: number,
    passFeeToBuyer: boolean,
    isTopSeller: boolean,
  ): FeeBreakdown {
    const listingPrice = listingPriceZarCents;
    const commissionZar = this.calculateCommission(listingPrice, isTopSeller);
    const processingFee = this.calculateProcessingFee(listingPrice);

    // If buyer absorbs fee: buyer pays price + fee, seller receives price - commission
    // If seller absorbs fee: buyer pays price,       seller receives price - commission - fee
    const buyerTotal = passFeeToBuyer ? listingPrice + processingFee : listingPrice;
    const sellerPayout = passFeeToBuyer
      ? listingPrice - commissionZar
      : listingPrice - commissionZar - processingFee;

    return {
      listingPrice,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout: Math.max(0, sellerPayout),
    };
  }
}
