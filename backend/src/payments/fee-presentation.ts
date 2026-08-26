import { FeeModel } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// ONE PLACE THAT DECIDES HOW A SALE'S MONEY IS SHOWN.
//
// We run two economically opposite fee models that write IDENTICAL columns:
//
//   BUYNOW_MARKUP  — commission and the gateway fee are built INTO
//                    listingPrice. The buyer pays the listed number and
//                    nothing else; the seller receives their full ask.
//   SELLER_DEDUCT  — the older model, still correct for auction wins,
//                    accepted offers, experiences and legacy rows. Fees sit
//                    OUTSIDE listingPrice: the buyer may be charged the
//                    gateway fee on top, and the seller really is deducted.
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
 * ⚠️ A FIRST-PARTY SALE HAS NO SELLER. Daily Deals zero both commissionZar
 * and sellerPayout because All Outdoor is the seller of record, and a refund
 * child row does the same. Neither can produce a seller breakdown that
 * balances against a non-zero price, so they are answered explicitly rather
 * than being allowed to fail the invariant.
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

  // ⚠️ ONLY under SELLER_DEDUCT, and only when the buyer really was charged.
  // Under the markup model this amount is already inside "Item price"; adding
  // it here is the double-count that made the receipt stop footing.
  //
  // "Transaction fee" is the operator's wording for the buyer-facing label —
  // never "processing fee", which is what the SELLER sees deducted.
  if (
    f.feeModel === FeeModel.SELLER_DEDUCT &&
    f.passFeeToBuyer &&
    f.processingFee > 0
  ) {
    lines.push({ label: 'Transaction fee', cents: f.processingFee });
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

  if (f.feeModel === FeeModel.BUYNOW_MARKUP) {
    return {
      grossLabel: 'Your price',
      gross: f.sellerPayout,
      deductions: [],
      netLabel: 'You receive',
      net: f.sellerPayout,
      feesInPrice: true,
      note: `Listed to the buyer at ${randPhrase(
        f.listingPrice,
      )}. Our fees were built into that price, so nothing is deducted from you.`,
      // ⚠️ THE MARKUP IDENTITY, not a restatement of "nothing was deducted"
      // (which would be true by construction and therefore worthless). If a
      // row is labelled BUYNOW_MARKUP, the price the buyer saw must be the
      // seller's ask with our two fees stacked on top — that is how
      // listPriceFromSellerAsk built it. A row failing this is mislabelled,
      // and the caller should not present it as a markup sale.
      balances:
        f.listingPrice === f.sellerPayout + f.commissionZar + f.processingFee,
    };
  }

  const deductions: MoneyLine[] = [];
  if (f.commissionZar > 0) {
    deductions.push({ label: 'Commission', cents: f.commissionZar });
  }
  // The seller only carries the gateway fee when the buyer did not.
  if (!f.passFeeToBuyer && f.processingFee > 0) {
    deductions.push({ label: 'Payment processing fee', cents: f.processingFee });
  }

  return {
    grossLabel: 'Sale price',
    gross: f.listingPrice,
    deductions,
    netLabel: 'You receive',
    net: f.sellerPayout,
    feesInPrice: false,
    note: f.passFeeToBuyer
      ? 'The buyer paid the transaction fee; our commission comes off the sale price.'
      : 'Our commission and the payment fee come off the sale price.',
    balances: f.listingPrice - sum(deductions) === f.sellerPayout,
  };
}

/**
 * R-prefixed rand, comma thousands separator.
 *
 * ⚠️ en-US ON PURPOSE. en-ZA yields a non-breaking space (U+00A0) which some
 * PDF fonts have no glyph for — it rendered as "R 10<FFFD>000" on a live Zoho
 * invoice. Same reasoning as ZohoBooksService.formatRand.
 */
function randPhrase(cents: number): string {
  const rand = cents / 100;
  return `R${rand.toLocaleString('en-US', {
    minimumFractionDigits: rand % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The one definition of which model a sale ran under.
 *
 * Mirrors the branch TransactionsService takes when it prices a checkout, so
 * the stored column and the maths can never disagree.
 *
 * ⚠️ An EXPERIENCE is SELLER_DEDUCT because the service tests isExperience
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
