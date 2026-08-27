import { Injectable } from '@nestjs/common';

// Commission bands — ZAR cents. Tax-bracket style: each band's `limit`
// is the WIDTH of the slice (not a cumulative cap), so the marginal
// rate only applies to the rand that fall inside that slice.
//
// Reduced 2026-05-20: every band dropped by 1 percentage point and a
// minimum platform fee added (see MIN_COMMISSION_CENTS below — R30 then,
// lowered to R10 in 2026-08). The
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

// Card-gateway processing fee. Peach is the gateway (Stitch was evaluated in
// 2026-06/07 and dropped); its published rate is
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

// P6.4 — flat GG shipping handling margin, ZAR cents. Charged ONCE per waybill
// the platform creates (a courier PUDO/TCG parcel). Buyer-paid and GG-RETAINED
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
   * sees. Operator decision 2026-08-15.
   *
   * The old model took our cut OUT of the seller's price: they listed R450,
   * we deducted commission, they got R409.50. The new one builds it IN: they
   * ask R450, we list at R511.97, and they receive the R450 they asked for.
   * Same percentages, opposite direction.
   *
   * Why it is worth the change: "list free, keep 100%" is a far stronger
   * message to a seller than "we take 9%", even though the money comes from
   * the same transaction. Yaga runs on exactly this and charges sellers
   * nothing at all.
   *
   * WHERE WE DIFFER FROM YAGA, deliberately: they show "R450 + Buyer
   * Protection fee" and reveal the real number at checkout. We bake it into
   * the listed price, so the number on the card IS the number you pay. No
   * surprise at the last step.
   *
   * The stack, in order — each layer applies to the running total, because
   * that is what the next layer is actually charged on:
   *
   *   ask                                    R450.00   seller receives this
   *   + commission (banded, min R30)         R 40.50   our margin
   *   = subtotal                             R490.50
   *   + Peach on the subtotal (4.025%+R1.73) R 21.47   recovers the gateway
   *   = LIST PRICE                           R511.97   the buyer sees this
   *
   * KNOWN, ACCEPTED RESIDUAL: Peach charges its percentage on the FINAL
   * amount the buyer is billed, not on the subtotal we applied it to — so
   * marking up by 4.025% of R490.50 recovers slightly less than the fee
   * eventually charged on R511.97. About R0.86 on a R450 ask (0.17%). Exact
   * recovery would need `list = (ask + commission + fixed) / (1 - rate)`;
   * that is a one-line change here if the leak is ever worth closing.
   *
   * Shipping is NOT in this base — it is unknown until checkout. Peach's
   * percentage on the shipping leg is covered by the R15/waybill handling
   * margin, which comfortably exceeds it (R15 against ~R3 on a R79 leg).
   */
  listPriceFromSellerAsk(
    sellerAskZarCents: number,
    isTopSeller: boolean,
    mode: PaymentMode = 'paygate',
  ): {
    sellerAsk: number;
    commissionZar: number;
    processingFee: number;
    listPrice: number;
  } {
    const sellerAsk = Math.max(0, Math.round(sellerAskZarCents));
    if (sellerAsk === 0) {
      return { sellerAsk: 0, commissionZar: 0, processingFee: 0, listPrice: 0 };
    }
    const commissionZar = this.calculateCommission(sellerAsk, isTopSeller);
    const subtotal = sellerAsk + commissionZar;
    const processingFee = this.calculateProcessingFee(subtotal, mode);
    return {
      sellerAsk,
      commissionZar,
      processingFee,
      listPrice: subtotal + processingFee,
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
    // The old model marks up the whole line because commission bands are
    // marginal and taper. Doing that here would make two units cost LESS than
    // twice the price on the card (the second unit falls into a cheaper band,
    // and the R30 floor is charged once). The listed price is a promise: two
    // of them cost exactly twice. Buyer-facing consistency wins over the few
    // rand of banding, and each unit really is a separate item at that price.
    const qty = Math.max(1, Math.round(quantity));
    const unit = this.listPriceFromSellerAsk(
      sellerAskZarCents,
      isTopSeller,
      mode,
    );
    const marked = {
      sellerAsk: unit.sellerAsk * qty,
      commissionZar: unit.commissionZar * qty,
      processingFee: unit.processingFee * qty,
      listPrice: unit.listPrice * qty,
    };
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));

    return {
      // What the buyer is charged for the goods — the number on the card.
      listingPrice: marked.listPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar: marked.commissionZar,
      processingFee: marked.processingFee,
      buyerTotal: marked.listPrice + shippingCost + shippingHandlingCents,
      // The whole point: the seller receives exactly what they asked for.
      sellerPayout: marked.sellerAsk,
    };
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
    // P6.4 — flat GG handling margin for this line, ZAR cents. Non-zero ONLY
    // for a courier line that produces its OWN waybill (the caller decides:
    // PUDO/TCG and not a zero-cost consolidated sibling). Buyer-paid on top of
    // everything else and GG-retained; it does NOT enter the processing-fee
    // base (we don't charge the EFT % on our own margin) and never touches the
    // seller payout. Defaults to 0 so every existing caller is unchanged.
    handlingFeeCents = 0,
  ): FeeBreakdown {
    const listingPrice = listingPriceZarCents;
    const shippingCost = Math.max(0, Math.round(shippingCostZarCents));
    const shippingHandlingCents = Math.max(0, Math.round(handlingFeeCents));
    const commissionZar = this.calculateCommission(listingPrice, isTopSeller);
    // The processing fee is charged on whatever the buyer actually pays,
    // which always includes shipping. Don't strip shipping out of the
    // base or we under-collect. Mode selects card (3.5%+R1.50) vs the
    // manual EFT flat 1.5%. The handling margin is EXCLUDED from the base.
    const processingFee = this.calculateProcessingFee(
      listingPrice + shippingCost,
      mode,
    );

    // If buyer absorbs fee: buyer pays price + shipping + fee,
    //                       seller receives price - commission
    // If seller absorbs fee: buyer pays price + shipping,
    //                        seller receives price - commission - fee
    // The R15 handling margin is buyer-paid regardless of who absorbs the
    // processing fee (it's a shipping surcharge, not the EFT fee).
    const buyerTotal =
      (passFeeToBuyer
        ? listingPrice + shippingCost + processingFee
        : listingPrice + shippingCost) + shippingHandlingCents;
    const sellerPayout = passFeeToBuyer
      ? listingPrice - commissionZar
      : listingPrice - commissionZar - processingFee;

    return {
      listingPrice,
      shippingCost,
      shippingHandlingCents,
      commissionZar,
      processingFee,
      buyerTotal,
      sellerPayout: Math.max(0, sellerPayout),
    };
  }
}
