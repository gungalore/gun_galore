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
export const SHIPPING_HANDLING_FEE_CENTS = 1_500; // R15 — per courier waybill

// ── Swop / Trade (SWOP) service fees — ZAR cents ────────────────────────
// A swap has no sale price, so GG earns a service fee per shipment leg
// (two legs per swap = earned twice). Originally a flat R50/leg (operator
// 2026-06-28); operator decision 2026-07-19: VALUE-BASED — a percentage of
// the sender's DECLARED item value, clamped to [min, cap]. Without this,
// two R50k rifles could swap for R100 total fees while GG carries KYC,
// proof-of-possession, dealer routing and dispute handling — a commission
// bypass for exactly the highest-value trades. The declared value is
// self-policing: it is public during negotiation and caps the sender's
// dispute compensation (over-declare = higher fee, under-declare = less
// protection). The old flat amounts survive as the per-leg MINIMUMS.
export const SWAP_SHIPPING_FEE_CENTS = 5_000; // R50 — courier-leg minimum
// Firearm leg minimum is higher: covers SAPS-534 verification + dealer
// coordination. Used from S6.
export const SWAP_FIREARM_FEE_CENTS = 10_000; // R100 — firearm-leg minimum
export const SWAP_VALUE_FEE_RATE = 0.015; // 1.5% of the declared value
export const SWAP_VALUE_FEE_CAP_CENTS = 75_000; // R750 cap keeps swapping cheaper than sell+buy
// PRO members get a discount on the swap service fee (applied after the
// min/cap clamp, so a PRO courier leg can go below R50).
export const SWAP_PRO_FEE_DISCOUNT = 0.25;

// P0.5 — commission on the swap CASH component. cashAmount had no ceiling
// and no fee beyond the flat legs, so any ordinary sale could be structured
// as "cheap item + big cash top-up" and dodge the commission engine while
// still consuming GG's payment risk. A cash top-up above the free allowance
// is economically a sale: the standard bands apply to the EXCESS (no cliff
// at the threshold), deducted from the cash the recipient is paid at
// settlement — exactly how a seller pays commission out of proceeds.
// Genuine balancing top-ups (≤ R1,000) stay free.
export const SWAP_CASH_COMMISSION_FREE_CENTS = 100_000; // R1,000 allowance

// What ONE party pays to fund their side of a swap. Each party funds the leg
// they SEND: the live courier rate for their parcel (remitted to the carrier)
// + the flat GG service fee + any cash top-up they owe. The 1.5% manual EFT
// handling is ABSORBED by GG out of the flat fee (operator decision
// 2026-06-29) — it is NOT added to what the member pays, so partyTotal is a
// clean courier + fee + cash figure. processingFee is retained only as GG's
// internal absorbed-cost figure (accounting / Zoho). Both parties must fund
// for the swap to lock; if only one funds, that party is fully reimbursed.
export interface SwapLegFeeBreakdown {
  courierCost: number; // carrier rate for this party's outbound parcel (remitted)
  serviceFee: number; // flat GG fee — margin (R50 courier / R100 firearm)
  cashContribution: number; // cash top-up this party owes (0 unless cash payer)
  subtotal: number; // courier + serviceFee + cashContribution
  processingFee: number; // 1.5% EFT cost GG ABSORBS (not charged to the party)
  partyTotal: number; // what this party actually pays = subtotal
}

export interface FeeBreakdown {
  listingPrice: number;   // ZAR cents
  shippingCost: number;   // ZAR cents — courier rate at checkout time (remitted to carrier)
  shippingHandlingCents: number; // ZAR cents — P6.4 flat GG per-waybill margin (buyer-paid, GG-retained)
  commissionZar: number;  // ZAR cents — platform commission off the listing price only
  processingFee: number;  // ZAR cents — gateway/EFT fee, charged on (listing + shipping)
  buyerTotal: number;     // ZAR cents — what the buyer pays
  sellerPayout: number;   // ZAR cents — what the seller actually receives
}

// EXP-E1 — fee breakdown for a hunting-package / experience booking. An
// experience is a future-dated ON-SITE service: no courier, no waybill, so
// shipping AND the R15 handling margin are always ZERO. Commission uses the
// SAME tiered bands as goods (breakdown()); the 1.5% manual processing fee
// passes through on the package price. Full value is HELD. buyerTotal =
// packagePrice + processingFee; sellerPayout = packagePrice − commission −
// (processingFee if the outfitter absorbs it). Structurally identical to
// FeeBreakdown so it flows through the same Transaction columns + Zoho.
export interface ExperienceFeeBreakdown extends FeeBreakdown {}

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
  ): FeeBreakdown {
    const marked = this.listPriceFromSellerAsk(
      sellerAskZarCents,
      isTopSeller,
      mode,
    );
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

  /**
   * What ONE party pays to fund their side of a swap (SWOP). A swap has no
   * sale price; GG earns a flat fee per leg and recovers the courier cost in
   * the same EFT. Each party funds the leg they SEND.
   *
   * - courierCostCents: live carrier rate for this party's outbound parcel
   *   (Pudo/TCG quote). Zero for a firearm leg (dealer transfer — no courier).
   * - cashContributionCents: cash top-up this party owes (0 unless they are
   *   the agreed cash payer).
   * - isFirearmLeg: swaps the flat fee from courier (R50) to firearm (R100).
   * - mode: selects the rate for the absorbed-cost figure ('manual' = 1.5%).
   *
   * partyTotal = courier + fee + cash (the 1.5% EFT cost is ABSORBED by GG,
   * not added). Independent + additive — leaves breakdown()/order math alone.
   */
  /**
   * P0.5 — platform commission retained from a swap's cash top-up at
   * settlement. Standard bands on the excess above the free allowance;
   * zero for genuine balancing amounts (≤ R1,000). No Top Seller
   * discount — a swap has no "seller". Deducted from the cash paid to
   * the recipient, never charged on top of what the payer funds.
   */
  swapCashCommission(cashAmountCents: number): number {
    const excess =
      Math.max(0, Math.round(cashAmountCents)) - SWAP_CASH_COMMISSION_FREE_CENTS;
    if (excess <= 0) return 0;
    return this.calculateCommission(excess, false);
  }

  /**
   * EXP-E1 — fee breakdown for a hunting-package / experience booking.
   *
   * An experience is a future-dated ON-SITE service: there is no courier and
   * no waybill, so shipping AND the P6.4 R15 handling margin are ALWAYS zero.
   * Everything else mirrors goods exactly — the standard tiered commission
   * bands (NOT a flat experience rate) via the shared calculateCommission, and
   * the mode-selected processing fee (manual = flat 1.5%). Full package value
   * is held.
   *
   * This is a thin per-mode wrapper over breakdown() (the breakdownSwapLeg
   * pattern): it pins shippingCost = 0 and handlingFee = 0 and delegates the
   * band commission + processing-fee maths to the one shared implementation,
   * so band parity with breakdown() for the same price is guaranteed by
   * construction. passFeeToBuyer is honoured the same way it is for goods:
   *   - passFeeToBuyer = true  → buyerTotal = price + processingFee,
   *                              sellerPayout = price − commission
   *   - passFeeToBuyer = false → buyerTotal = price,
   *                              sellerPayout = price − commission − processingFee
   * The returned shape is ExperienceFeeBreakdown (≡ FeeBreakdown with shipping
   * + handling pinned to 0) so it flows through the same Transaction columns
   * and Zoho commission-invoice path as an ordinary sale.
   */
  breakdownExperience(
    packagePriceZarCents: number,
    passFeeToBuyer: boolean,
    isTopSeller: boolean,
    mode: PaymentMode = 'manual',
  ): ExperienceFeeBreakdown {
    // No courier line + no waybill for an on-site service → shipping = 0 and
    // handling = 0. Delegating to breakdown() reuses the exact band-commission
    // + processing-fee logic (band parity guaranteed) rather than re-deriving.
    return this.breakdown(
      Math.max(0, Math.round(packagePriceZarCents)),
      passFeeToBuyer,
      isTopSeller,
      0, // shippingCost — on-site service, no courier rate
      mode,
      0, // handlingFeeCents — no waybill, no R15 margin
    );
  }

  /**
   * Value-based swap service fee for ONE leg: rate × the sender's declared
   * item value, clamped to [leg minimum, cap], then the PRO discount.
   * declaredValueCents 0/absent falls back to the leg minimum (legacy
   * listings created before the declared-value requirement).
   */
  swapServiceFee(
    declaredValueCents: number,
    isFirearmLeg = false,
    isPro = false,
  ): number {
    const min = isFirearmLeg ? SWAP_FIREARM_FEE_CENTS : SWAP_SHIPPING_FEE_CENTS;
    const raw = Math.round(
      Math.max(0, Math.round(declaredValueCents)) * SWAP_VALUE_FEE_RATE,
    );
    const clamped = Math.min(Math.max(raw, min), SWAP_VALUE_FEE_CAP_CENTS);
    return isPro
      ? Math.round(clamped * (1 - SWAP_PRO_FEE_DISCOUNT))
      : clamped;
  }

  breakdownSwapLeg(
    courierCostCents: number,
    cashContributionCents = 0,
    isFirearmLeg = false,
    mode: PaymentMode = 'manual',
    // Operator 2026-07-19 — value-based fee inputs. Defaults keep every
    // existing caller (and legacy zero-value listings) on the old flat fee.
    declaredValueCents = 0,
    isPro = false,
  ): SwapLegFeeBreakdown {
    const courierCost = isFirearmLeg
      ? 0
      : Math.max(0, Math.round(courierCostCents));
    const serviceFee = this.swapServiceFee(
      declaredValueCents,
      isFirearmLeg,
      isPro,
    );
    const cashContribution = Math.max(0, Math.round(cashContributionCents));
    const subtotal = courierCost + serviceFee + cashContribution;
    // GG absorbs the EFT handling out of the flat fee — computed for internal
    // accounting only, NOT added to what the party pays.
    const processingFee = this.calculateProcessingFee(subtotal, mode);
    return {
      courierCost,
      serviceFee,
      cashContribution,
      subtotal,
      processingFee,
      partyTotal: subtotal,
    };
  }
}
