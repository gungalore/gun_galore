import { FeeModel } from '@prisma/client';
import { FeeCalculator } from './fee.calculator';
import {
  buyerBreakdown,
  feeModelFor,
  sellerBreakdown,
  type FeeFacts,
} from './fee-presentation';

// ────────────────────────────────────────────────────────────────────
// THE RECEIPT THAT DID NOT ADD UP.
//
// Both fee models write the same columns, so every surface that rendered
// them had to guess which one it was looking at, and five of them guessed
// differently. The sharpest symptom: the receipt printed "Item price" — which
// under the markup model ALREADY contains the fee — then a separate
// "Processing fee" line, above a "Total paid" that excluded it. The lines
// overshot the total by the fee. On an auction with a legacy listing flag it
// broke the other way and undershot.
//
// Every fixture below is built by the REAL FeeCalculator, never hand-typed,
// so these tests fail if the calculator's arithmetic and the presentation
// ever drift apart.
// ────────────────────────────────────────────────────────────────────

const fees = new FeeCalculator();

const SHIP = 7_744; // a real Bob Go door rate, R77.44
const HANDLING = 774; // our 10% delivery margin on it

/** A marked-up BUY NOW: seller asks R450, we list at R511.97. */
function markupFacts(askCents = 45_000, quantity = 1): FeeFacts {
  const b = fees.breakdownBuyNow(
    askCents,
    false,
    SHIP,
    'paygate',
    HANDLING,
    quantity,
  );
  return {
    feeModel: FeeModel.BUYNOW_MARKUP,
    listingPrice: b.listingPrice,
    shippingCost: b.shippingCost,
    shippingHandlingCents: b.shippingHandlingCents,
    commissionZar: b.commissionZar,
    processingFee: b.processingFee,
    buyerTotal: b.buyerTotal,
    sellerPayout: b.sellerPayout,
    // ⚠️ TRUE, because the sell form hardcodes the listing flag true. This is
    // exactly the value that made the receipt print a phantom fee line.
    passFeeToBuyer: true,
  };
}

/** An auction win or accepted offer: the buyer carries the gateway fee. */
function deductFacts(priceCents = 45_000, buyerPaysFee = true): FeeFacts {
  const b = fees.breakdown(priceCents, buyerPaysFee, false, SHIP, 'paygate', HANDLING);
  return {
    feeModel: FeeModel.SELLER_DEDUCT,
    listingPrice: b.listingPrice,
    shippingCost: b.shippingCost,
    shippingHandlingCents: b.shippingHandlingCents,
    commissionZar: b.commissionZar,
    processingFee: b.processingFee,
    buyerTotal: b.buyerTotal,
    sellerPayout: b.sellerPayout,
    passFeeToBuyer: buyerPaysFee,
  };
}

const labels = (ls: { label: string }[]) => ls.map((l) => l.label);
const total = (ls: { cents: number }[]) => ls.reduce((t, l) => t + l.cents, 0);

describe('what the buyer is shown', () => {
  it('⚠️ foots exactly, under BOTH models — the whole point of this file', () => {
    for (const f of [
      markupFacts(),
      markupFacts(45_000, 3),
      markupFacts(5_000), // small ticket, where the R10 commission floor bites
      deductFacts(45_000, true),
      deductFacts(45_000, false),
      deductFacts(2_500_000, true), // crosses three commission bands
    ]) {
      const b = buyerBreakdown(f);
      expect(b.balances).toBe(true);
      expect(total(b.lines)).toBe(b.total);
      expect(b.total).toBe(f.buyerTotal);
    }
  });

  it('⚠️ never charges a marked-up buyer a fee line — the double-count', () => {
    // The regression. passFeeToBuyer is TRUE on this row (the sell form
    // hardcodes it), processingFee is non-zero, and the old condition was
    // `passFeeToBuyer && processingFee > 0` — so it printed a fee that was
    // already inside Item price, and the receipt stopped adding up.
    const f = markupFacts();
    expect(f.passFeeToBuyer).toBe(true);
    expect(f.processingFee).toBeGreaterThan(0);

    const b = buyerBreakdown(f);
    expect(labels(b.lines)).not.toContain('Transaction fee');
    expect(labels(b.lines)).not.toContain('Processing fee');
    // And it still foots — which it did not before.
    expect(total(b.lines)).toBe(f.buyerTotal);
  });

  it('⚠️ DOES charge an auction buyer a fee line — the inverse break', () => {
    // A seller who ticked "I'll absorb the fee" then ran an auction: the
    // server forces the buyer to pay it, but the row stored the listing's
    // false flag, so the receipt omitted the line and undershot the total.
    // The stored flag is now the EFFECTIVE one, so the line appears.
    const f = deductFacts(45_000, true);
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).toContain('Transaction fee');
    expect(total(b.lines)).toBe(f.buyerTotal);
  });

  it('omits the fee line when the seller absorbed it', () => {
    const b = buyerBreakdown(deductFacts(45_000, false));
    expect(labels(b.lines)).not.toContain('Transaction fee');
    expect(b.balances).toBe(true);
  });

  it('⚠️ shows delivery as ONE figure, never splitting out our margin', () => {
    // fee.calculator.ts is explicit: the handling margin "IS NEVER SHOWN
    // SEPARATELY". The receipt was printing "Shipping" and "Handling" as two
    // lines, which published our delivery margin to the buyer.
    const f = markupFacts();
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).not.toContain('Handling');
    const delivery = b.lines.find((l) => l.label === 'Delivery');
    expect(delivery?.cents).toBe(f.shippingCost + f.shippingHandlingCents);
  });

  it('drops the delivery line entirely when there is none', () => {
    // A firearm dealer transfer or a collection books no waybill.
    const f = { ...markupFacts(), shippingCost: 0, shippingHandlingCents: 0 };
    f.buyerTotal = f.listingPrice;
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).toEqual(['Item price']);
    expect(b.balances).toBe(true);
  });
});

describe('what the seller is shown', () => {
  it('⚠️ deducts NOTHING under the markup model', () => {
    // Showing commission as a deduction here is a false statement about
    // their money: they asked R450 and they receive R450. Our cut came from
    // marking the buyer's price up, not from their proceeds.
    const f = markupFacts();
    const s = sellerBreakdown(f);
    expect(s.deductions).toEqual([]);
    expect(s.net).toBe(45_000);
    expect(s.feesInPrice).toBe(true);
    expect(s.balances).toBe(true);
    expect(s.note).toContain('nothing is deducted from you');
  });

  it('deducts commission — and the fee too when the seller carried it', () => {
    const buyerPaid = sellerBreakdown(deductFacts(45_000, true));
    expect(labels(buyerPaid.deductions)).toEqual(['Commission']);
    expect(buyerPaid.balances).toBe(true);

    const sellerPaid = sellerBreakdown(deductFacts(45_000, false));
    expect(labels(sellerPaid.deductions)).toEqual([
      'Commission',
      'Payment processing fee',
    ]);
    expect(sellerPaid.balances).toBe(true);
  });

  it('⚠️ foots under both models across the band range', () => {
    for (const f of [
      markupFacts(5_000),
      markupFacts(45_000),
      markupFacts(2_500_000),
      deductFacts(5_000, true),
      deductFacts(45_000, false),
      deductFacts(2_500_000, true),
    ]) {
      const s = sellerBreakdown(f);
      expect(s.balances).toBe(true);
      if (s.deductions.length) {
        expect(s.gross - total(s.deductions)).toBe(s.net);
      }
    }
  });

  it('⚠️ answers a first-party sale instead of failing the invariant', () => {
    // Daily Deals zero commission AND payout because All Outdoor is the
    // seller of record; a refund child row looks the same. Neither can
    // balance against a non-zero price.
    const f = { ...deductFacts(), commissionZar: 0, sellerPayout: 0 };
    const s = sellerBreakdown(f);
    expect(s.net).toBe(0);
    expect(s.balances).toBe(true);
    expect(s.note).toBe('This sale has no seller payout.');
  });

  it('handles commission swallowing a tiny sale whole', () => {
    // The R10 floor is capped at the price itself, so payout can be 0
    // legitimately — and that is NOT a house sale, because commission > 0.
    const f = deductFacts(800, true);
    const s = sellerBreakdown(f);
    expect(s.balances).toBe(true);
    expect(s.note).not.toBe('This sale has no seller payout.');
  });
});

describe('choosing the model', () => {
  it('marks up only a real buy-now', () => {
    expect(feeModelFor({ isExperience: false, isMarkedUpBuyNow: true })).toBe(
      FeeModel.BUYNOW_MARKUP,
    );
    expect(feeModelFor({ isExperience: false, isMarkedUpBuyNow: false })).toBe(
      FeeModel.SELLER_DEDUCT,
    );
  });

  it('⚠️ keeps an experience on the deduct model', () => {
    // The service tests isExperience BEFORE the buy-now branch, so an
    // experience never reaches breakdownBuyNow even when the listing carries
    // a sellerAskCents. Getting this backwards would tell an outfitter their
    // fees were included when they were in fact deducted.
    expect(feeModelFor({ isExperience: true, isMarkedUpBuyNow: true })).toBe(
      FeeModel.SELLER_DEDUCT,
    );
  });
});
