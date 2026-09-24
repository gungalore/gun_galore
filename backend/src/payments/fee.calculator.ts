import { Injectable } from '@nestjs/common';

// Commission bands — ZAR cents. Tax-bracket style: each band's `limit`
// is the WIDTH of the slice (not a cumulative cap), so the marginal
// rate only applies to the rand that fall inside that slice.
//
// Operator decision 2026-09: widened to 10 / 8 / 6 / 4 across R5,000 /
// R15,000 / R25,000. The R10 minimum (MIN_COMMISSION_CENTS) still protects
// small-ticket sales — 10% of a R50 item is R5, below the floor.
export const BANDS: { limit: number; rate: number; label: string }[] = [
  { limit: 500_000, rate: 0.10, label: 'First R5,000 at 10%' },
  { limit: 1_000_000, rate: 0.08, label: 'R5,001–R15,000 at 8%' },
  { limit: 1_000_000, rate: 0.06, label: 'R15,001–R25,000 at 6%' },
  { limit: Infinity, rate: 0.04, label: 'Above R25,000 at 4%' },
];

// Floor on platform commission. The bands above are applied first, then
// the result is bumped up to MIN_COMMISSION_CENTS if it falls below.
// Surfaced to the seller in the Sell form so there are no surprises.
//
// LOWERED R30 -> R10 on 2026-08-15. The R30 floor existed to cover VerifyNow
// KYC at ~R28 per seller; that cost is gone — identity checks now run through
// the Claude-vision flow at roughly R3. Holding R30 was charging sellers for a
// bill we no longer pay.
//
// It also became visible when the markup model shipped: the floor used to be a
// quiet deduction, but it is now ON THE PRICE TAG. At R30 a R50 ask listed at
// R84.94 — a ~70% markup a buyer can see. At R10 the same item lists at R64.14.
export const MIN_COMMISSION_CENTS = 1_000; // R10

// Top Seller discount — 0.5% off total price. LOCKED per CLAUDE.md.
const TOP_SELLER_DISCOUNT = 0.005;

// Buyer Protection Fee — the gateway cost, rebased as a buyer-facing service
// (operator decision 2026-09). Ozow card pricing is 2.85% + R1.00 net; with
// 15% VAT that is 3.28% + R1.15 inclusive, the figure the operator supplied
// and the figure the buyer sees. Charged on (item + shipping). This replaced
// the 1.5% Pay-by-Bank rate and is no longer VAT-grossed-up here — the
// constant is already inclusive.
const OZOW_RATE = 0.0328;
const OZOW_FIXED_CENTS = 115; // R1.15 inclusive, per transaction

// Manual EFT processing fee. While there is no card gateway, buyers pay
// GG by bank EFT and a flat 1.5% handling fee is added to the order (no
// fixed component). Operator decision 2026-06: manual mode = 1.5%, the
// dormant paygate keeps the 3.5%+R1.50 card rate.
const MANUAL_RATE = 0.015;

// Which fee schedule to apply. 'paygate' = card gateway rate (default,
// keeps every existing caller unchanged); 'manual' = flat 1.5% EFT fee.
export type PaymentMode = 'paygate' | 'manual';

// P6.4 — flat GG shipping handling margin, ZAR cents. Charged ONCE per waybill
// the platform creates (a courier parcel). Buyer-paid and GG-RETAINED
// (not remitted to the carrier), so shipping stops being pure cost pass-through.
// A consolidated multi-item parcel books ONE waybill, so it is charged ONCE (on
// the carrier line only). Firearm dealer/in-person transfers and collection
// create no waybill and are never charged this. Operator decision 2026-07-03:
// R15/waybill.
// Our margin on delivery, as a share of the carrier's own rate.
//
// Replaced a flat R15 per waybill on 2026-08-15. A flat fee is regressive on
// cheap legs and invisible on dear ones — R15 was 19% of a R79 collection-point
// leg but only 6% of a R250 one. A percentage tracks the cost of the thing we
// are actually carrying risk and admin on.
//
// IT IS NEVER SHOWN SEPARATELY. The buyer sees ONE delivery figure, already
// inclusive — same principle as the item price carrying its own markup. The
// split is preserved server-side (Transaction.shippingCost is the pure carrier
// remittance, shippingHandlingCents is ours) because those are two different
// obligations at payout time, not because the buyer needs the arithmetic.
export const SHIPPING_HANDLING_RATE = 0.1; // 10% of the carrier rate

/**
 * Our delivery margin in cents, from the carrier's quoted rate.
 *
 * Rounded, and never negative — a carrier rate of zero (a firearm dealer
 * transfer, a collection, a consolidated sibling riding another parcel's
 * waybill) earns nothing, which is correct: there is no waybill to service.
 */
export function shippingHandlingCentsFor(carrierRateCents: number): number {
  return Math.max(0, Math.round(Math.max(0, carrierRateCents) * SHIPPING_HANDLING_RATE));
}

/** What the buyer sees for delivery: the carrier rate with our margin folded in. */
export function displayShippingCents(carrierRateCents: number): number {
  const rate = Math.max(0, Math.round(carrierRateCents));
  return rate + shippingHandlingCentsFor(rate);
}

export interface FeeBreakdown {
  listingPrice: number;   // ZAR cents
  shippingCost: number;   // ZAR cents — courier rate at checkout time (remitted to carrier)
  shippingHandlingCents: number; // ZAR cents — GG delivery margin (10% of the carrier rate; buyer-paid, GG-retained, never shown separately)
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
   * BUY NOW — turn what the SELLER wants to receive into the price the buyer
   * sees. Operator decision 2026-08-15; fee stack changed 2026-09.
   *
   * The seller asks R1,000 and receives exactly R1,000. Our commission is
   * built INTO the listed price, so the seller never sees a deduction from
   * their ask. The Buyer Protection Fee is NOT baked in any more (operator
   * 2026-09): it is added at checkout on (item + shipping), the same way the
   * auction path charges it, so the listed number stays a clean
   * "ask + commission".
   *
   *   ask                          R1,000   seller receives this
   *   + commission (banded)        R  100   our margin
   *   = LIST PRICE                 R1,100   the buyer sees this
   *
   * The buyer then pays LIST PRICE + Buyer Protection Fee + shipping.
   *
   * Shipping is not in this base — it is unknown until checkout.
   */
  listPriceFromSellerAsk(
    sellerAskZarCents: number,
    isTopSeller: boolean,
    _mode: PaymentMode = 'paygate',
  ): {
    sellerAsk: number;
    commissionZar: number;
    listPrice: number;
  } {
    const sellerAsk = Math.max(0, Math.round(sellerAskZarCents));
    if (sellerAsk === 0) {
      return { sellerAsk: 0, commissionZar: 0, listPrice: 0 };
    }
    const commissionZar = this.calculateCommission(sellerAsk, isTopSeller);
    return {
      sellerAsk,
      commissionZar,
      listPrice: sellerAsk + commissionZar,
    };
  }

  /**
   * BUY NOW breakdown, from a listing whose price ALREADY carries the markup.
   *
   * The buyer pays the listed price full stop — nothing is added at checkout
   * except shipping and the handling margin, neither of which can be known
   * before an address exists.
   *
   * Takes the seller's ask rather than re-deriving it from the list price:
   * the ask is what was agreed with the seller and is stored on the listing,
   * and reversing a banded, minimum-floored, top-seller-discounted markup is
   * not reliably invertible. Recomputing forward from the ask always agrees
   * with what the seller was shown.
   */
  breakdownBuyNow(
    sellerAskZarCents: number,
    isTopSeller: boolean,
    shippingCostZarCents = 0,
    mode: PaymentMode = 'paygate',
    handlingFeeCents = 0,
    quantity = 1,
  ): FeeBreakdown {
    // PER UNIT, then multiplied — NOT marked up on the line subtotal.
    //
    // Commission bands are marginal and taper, so re-banding the whole line
    // would make two units cost LESS than twice the price on the card (the
    // second unit falls into a cheaper band and the R10 floor is charged
    // once). The listed price is a promise: two of them cost exactly twice.
    const qty = Math.max(1, Math.round(quantity));
    const unit = this.listPriceFromSellerAsk(
      sellerAskZarCents,
      isTopSeller,
      mode,
    );
    const marked = {
      sellerAsk: unit.sellerAsk * qty,
      commissionZar: unit.commissionZar * qty,
      listPrice: unit.listPrice * qty,
    };
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));
    // Buyer Protection Fee — charged at checkout on (item + shipping), NOT
    // baked into the listed price (operator 2026-09). The buyer always pays it.
    const processingFee = this.calculateProcessingFee(
      marked.listPrice + shippingCost,
      mode,
    );

    return {
      // What the buyer is charged for the goods — the number on the card.
      listingPrice: marked.listPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar: marked.commissionZar,
      processingFee,
      buyerTotal:
        marked.listPrice + processingFee + shippingCost + shippingHandlingCents,
      // The whole point: the seller receives exactly what they asked for.
      sellerPayout: marked.sellerAsk,
    };
  }

  /**
   * Buyer Protection Fee on a given base (listing price + shipping).
   * - 'paygate': Ozow card, VAT-inclusive — base × 3.28% + R1.15.
   * - 'manual': legacy flat 1.5% EFT handling fee, no fixed component.
   */
  calculateProcessingFee(baseZarCents: number, mode: PaymentMode = 'paygate'): number {
    if (!Number.isFinite(baseZarCents) || baseZarCents <= 0) return 0;
    if (mode === 'manual') {
      return Math.round(baseZarCents * MANUAL_RATE);
    }
    return Math.round(baseZarCents * OZOW_RATE + OZOW_FIXED_CENTS);
  }

  /**
   * Full breakdown. `shippingCost` is the courier quote at checkout
   * time, paid by the buyer on top of the listing price (per house
   * standard — shipping is always passed to the buyer for marketplace
   * sales). Zero for firearm DEALER_TRANSFER / PRIVATE_ARRANGE since
   * those don't use the courier API.
   */
  breakdown(
    listingPriceZarCents: number,
    _passFeeToBuyer: boolean,
    isTopSeller: boolean,
    shippingCostZarCents = 0,
    mode: PaymentMode = 'paygate',
    // P6.4 — flat GG handling margin for this line, ZAR cents. Non-zero ONLY
    // for a courier line that produces its OWN waybill (the caller decides:
    // courier and not a zero-cost consolidated sibling). Buyer-paid on top of
    // everything else and GG-retained; it does NOT enter the protection-fee
    // base (we don't charge the fee on our own margin) and never touches the
    // seller payout. Defaults to 0 so every existing caller is unchanged.
    handlingFeeCents = 0,
  ): FeeBreakdown {
    const listingPrice = listingPriceZarCents;
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));
    const commissionZar = this.calculateCommission(listingPrice, isTopSeller);
    // The Buyer Protection Fee is charged on whatever the buyer actually
    // pays, which always includes shipping. The handling margin is EXCLUDED
    // from the base.
    const processingFee = this.calculateProcessingFee(
      listingPrice + shippingCost,
      mode,
    );

    // Operator 2026-09: the buyer ALWAYS carries the Buyer Protection Fee.
    // The seller-absorb branch is retired — `_passFeeToBuyer` is kept only so
    // existing call sites and stored rows still type-check, and is ignored.
    const buyerTotal =
      listingPrice + processingFee + shippingCost + shippingHandlingCents;
    const sellerPayout = Math.max(0, listingPrice - commissionZar);

    return {
      listingPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout,
    };
  }
}
