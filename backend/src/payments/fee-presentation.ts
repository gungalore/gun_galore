import { FeeModel } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// ONE PLACE THAT DECIDES HOW A SALE'S MONEY IS SHOWN.
//
// We run two fee models that write IDENTICAL columns:
//
//   BUYNOW_MARKUP  — the seller receives their full ask and pays nothing.
//                    The buyer pays the Platform Fee at checkout on
//                    (item + delivery). (The enum name is historical: the
//                    fee is no longer baked into the listed price.)
//   SELLER_DEDUCT  — auctions (and legacy/experience rows). The seller pays
//                    a commission off the sale price, and the buyer pays a
//                    buyer-side Platform Fee on top.
//
// Because the columns look the same, every surface that rendered them was
// left to guess, and five of them guessed differently. The receipt printed
// "Item price" (which already contained the fee) PLUS a "Processing fee"
// line, above a "Total paid" that excluded it — so its own line items did
// not sum to its own total. The seller's statement billed a processing fee
// on auctions that never charged one. Zoho's reference line spelled out a
// subtraction that had not happened.
//
// ⚠️ THE INVARIANT THIS FILE EXISTS TO ENFORCE: the lines shown to a human
// ADD UP to the total shown to that human, under BOTH models. `balances` is
// computed, not assumed, and the spec asserts it across the matrix. If a
// future model breaks the arithmetic, a test fails here rather than a buyer
// finding a receipt that does not foot.
//
// ⚠️ CENTS IN, CENTS OUT. No formatting — callers render (PDF, email HTML,
// SMS, CSV, JSON). Formatting is where the U+FFFD thousands-separator bug
// lived; it does not belong in the arithmetic.
// ────────────────────────────────────────────────────────────────────

/** The columns this module reads. Structural, so any caller can pass a row. */
export interface FeeFacts {
  feeModel: FeeModel;
  listingPrice: number;
  shippingCost: number;
  shippingHandlingCents: number;
  commissionZar: number;
  processingFee: number;
  buyerTotal: number;
  sellerPayout: number;
  /**
   * Whether the BUYER was charged the gateway fee as a separate line.
   *
   * ⚠️ Only meaningful under SELLER_DEDUCT. Under BUYNOW_MARKUP the fee was
   * never a separate charge, so this is ignored entirely — read feeModel
   * first, always.
   */
  passFeeToBuyer: boolean;
}

export interface MoneyLine {
  label: string;
  cents: number;
}

export interface BuyerBreakdown {
  /** Rendered in order. Guaranteed to sum to `total` when `balances` is true. */
  lines: MoneyLine[];
  totalLabel: string;
  total: number;
  /** Did the lines actually foot? Callers may log a false; never hide it. */
  balances: boolean;
}

export interface SellerBreakdown {
  grossLabel: string;
  gross: number;
  /** Positive amounts, each SUBTRACTED from gross. Empty under the markup model. */
  deductions: MoneyLine[];
  netLabel: string;
  net: number;
  /** True when our cut was inside the price rather than taken off the seller. */
  feesInPrice: boolean;
  /** One plain sentence explaining the model to the seller. Never empty. */
  note: string;
  balances: boolean;
}

const sum = (lines: MoneyLine[]) => lines.reduce((t, l) => t + l.cents, 0);

/**
 * ⚠️ A ROW WITH NO SELLER SIDE. A refund child row zeroes both commissionZar
 * and sellerPayout, as would any future first-party sale where ALL Outdoor is
 * the seller of record. Such a row cannot produce a seller breakdown that
 * balances against a non-zero price, so it is answered explicitly rather than
 * being allowed to fail the invariant.
 */
const isHouseOrRefundRow = (f: FeeFacts) =>
  f.sellerPayout === 0 && f.commissionZar === 0 && f.listingPrice > 0;

/**
 * What the BUYER was charged, as lines that foot to what they actually paid.
 *
 * ⚠️ DELIVERY IS ONE LINE. The carrier rate and our handling margin are
 * stored apart because they are different obligations at payout time, but
 * fee.calculator.ts is explicit that the margin "IS NEVER SHOWN SEPARATELY —
 * the buyer sees ONE delivery figure, already inclusive". The receipt was
 * itemising "Shipping" and "Handling" as two lines, which published our
 * delivery margin to the buyer. Same principle as the item price carrying
 * its own markup.
 */
export function buyerBreakdown(f: FeeFacts): BuyerBreakdown {
  const lines: MoneyLine[] = [{ label: 'Item price', cents: f.listingPrice }];

  const delivery = f.shippingCost + f.shippingHandlingCents;
  if (delivery > 0) lines.push({ label: 'Delivery', cents: delivery });

  // Buyer-paid Platform Fee — the single combined charge that replaced the
  // old Buyer Protection Fee. It is calculated last on (item + delivery), so
  // it is never inside "Item price" and never double-counts.
  if (f.processingFee > 0) {
    lines.push({ label: 'Platform Fee', cents: f.processingFee });
  }

  return {
    lines,
    totalLabel: 'Total paid',
    total: f.buyerTotal,
    balances: sum(lines) === f.buyerTotal,
  };
}

/**
 * What the SELLER receives, and whether anything was taken off them.
 *
 * Under BUYNOW_MARKUP there are NO deductions — showing commission as one
 * would be a false statement about their money. They asked for a number and
 * they receive that number; our cut came from marking the buyer's price up.
 */
export function sellerBreakdown(f: FeeFacts): SellerBreakdown {
  if (isHouseOrRefundRow(f)) {
    return {
      grossLabel: 'Seller payout',
      gross: 0,
      deductions: [],
      netLabel: 'Seller payout',
      net: 0,
      feesInPrice: false,
      note: 'This sale has no seller payout.',
      balances: true,
    };
  }

  // Operator 2026-10: the seller is shown an honest statement.
  //
  // Buy Now: the buyer paid the Platform Fee, so there is NOTHING to deduct —
  // showing a deduction would be a false statement about the seller's money.
  // They asked for a number and receive that number.
  //
  // Auction: the 5% seller commission really is taken off the hammer, so it
  // appears as one deduction.
  const deductions: MoneyLine[] = [];
  if (f.feeModel === FeeModel.SELLER_DEDUCT && f.commissionZar > 0) {
    deductions.push({ label: 'Platform Fee', cents: f.commissionZar });
  }

  return {
    grossLabel: 'Sale price',
    gross: f.listingPrice,
    deductions,
    netLabel: 'You receive',
    net: f.sellerPayout,
    feesInPrice: f.feeModel === FeeModel.BUYNOW_MARKUP,
    note:
      f.feeModel === FeeModel.BUYNOW_MARKUP
        ? 'The buyer paid the Platform Fee; you receive your full asking price.'
        : 'Our platform fee comes off the sale price.',
    balances: f.listingPrice - sum(deductions) === f.sellerPayout,
  };
}

/**
 * The one definition of which model a sale ran under.
 *
 * Mirrors the branch TransactionsService takes when it prices a checkout, so
 * the stored column and the maths can never disagree.

 * BEFORE the buy-now branch and prices it with breakdownExperience, which
 * honours the listing's own fee flag and deducts from the seller.
 *
 * ⚠️ BUT THE LISTING WAS STILL MARKED UP. listings.service.priceFieldsFor
 * excludes only `listingType !== BUY_NOW` — NOT experiences — so a BUY_NOW
 * experience gets sellerAskCents set and Listing.price marked up, and then
 * checkout deducts commission from that already-marked-up price. Commission
 * is charged twice on the same booking, and sellerAskCents is silently
 * ignored. That is a PRICING defect in listings.service, not a labelling one
 * here: SELLER_DEDUCT correctly describes what checkout did. Inert today (no
 * experience category exists on production) and left for an operator call —
 * whether an outfitter should list free and keep 100% like every other seller
 * is a business decision, not a bug fix.
 */
export function feeModelFor(args: {
  isExperience: boolean;
  isMarkedUpBuyNow: boolean;
}): FeeModel {
  return !args.isExperience && args.isMarkedUpBuyNow
    ? FeeModel.BUYNOW_MARKUP
    : FeeModel.SELLER_DEDUCT;
}
