import { FeeModel } from '@prisma/client';
import { FeeCalculator } from './fee.calculator';
import {
  buyerBreakdown,
  feeModelFor,
  sellerBreakdown,
  type FeeFacts,
} from './fee-presentation';

// ────────────────────────────────────────────────────────────────────
// HOW A SALE'S MONEY IS SHOWN.
//
// Operator 2026-09: the buyer ALWAYS carries the Buyer Protection Fee, under
// both fee models, and it is added at checkout on (item + shipping) — never
// baked into the listed price. The seller is shown the sale price less our
// platform fee, under both models (the H&G-style statement). Every fixture is
// built by the REAL FeeCalculator, so these tests fail if the calculator's
// arithmetic and the presentation ever drift apart.
// ────────────────────────────────────────────────────────────────────

const fees = new FeeCalculator();

const SHIP = 7_744; // a real Bob Go door rate, R77.44
const HANDLING = 774; // our 10% delivery margin on it

/** A marked-up BUY NOW: seller asks R450, we list at R495. */
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
    passFeeToBuyer: true,
  };
}

/** An auction win or accepted offer. */
function deductFacts(priceCents = 45_000): FeeFacts {
  const b = fees.breakdown(priceCents, true, false, SHIP, 'paygate', HANDLING);
  return {
    feeModel: FeeModel.SELLER_DEDUCT,
    listingPrice: b.listingPrice,
    shippingCost: b.shippingCost,
    shippingHandlingCents: b.shippingHandlingCents,
    commissionZar: b.commissionZar,
    processingFee: b.processingFee,
    buyerTotal: b.buyerTotal,
    sellerPayout: b.sellerPayout,
    passFeeToBuyer: true,
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
      deductFacts(45_000),
      deductFacts(2_500_000), // crosses three commission bands
    ]) {
      const b = buyerBreakdown(f);
      expect(b.balances).toBe(true);
      expect(total(b.lines)).toBe(b.total);
      expect(b.total).toBe(f.buyerTotal);
    }
  });

  it('⚠️ always shows the Buyer Protection Fee — under BOTH models', () => {
    // The buyer carries it whether the sale ran as a markup or a deduct.
    for (const f of [markupFacts(), deductFacts()]) {
      const b = buyerBreakdown(f);
      expect(labels(b.lines)).toContain('Buyer Protection Fee');
      expect(total(b.lines)).toBe(f.buyerTotal);
    }
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
    // A firearm dealer transfer or a collection books no waybill. The
    // Protection Fee still applies — it is on the item.
    const f = { ...markupFacts(), shippingCost: 0, shippingHandlingCents: 0 };
    f.buyerTotal = f.listingPrice + f.processingFee;
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).toEqual(['Item price', 'Buyer Protection Fee']);
    expect(b.balances).toBe(true);
  });
});

describe('what the seller is shown', () => {
  it('⚠️ shows the sale price less our platform fee, under both models', () => {
    // The H&G-style statement: gross sale price, one platform-fee deduction,
    // net payout. On a markup listing the seller still receives their full
    // ask — the fee came from the buyer's marked-up price.
    for (const f of [markupFacts(), deductFacts()]) {
      const s = sellerBreakdown(f);
      expect(labels(s.deductions)).toEqual(['Platform Fee']);
      expect(s.gross).toBe(f.listingPrice);
      expect(s.net).toBe(f.sellerPayout);
      expect(s.balances).toBe(true);
    }
  });

  it('keeps the markup seller whole — net is their ask', () => {
    const s = sellerBreakdown(markupFacts(45_000));
    expect(s.net).toBe(45_000);
    expect(s.note).toContain('included our platform fee');
  });

  it('⚠️ foots under both models across the band range', () => {
    for (const f of [
      markupFacts(5_000),
      markupFacts(45_000),
      markupFacts(2_500_000),
      deductFacts(5_000),
      deductFacts(45_000),
      deductFacts(2_500_000),
    ]) {
      const s = sellerBreakdown(f);
      expect(s.balances).toBe(true);
      expect(s.gross - total(s.deductions)).toBe(s.net);
    }
  });

  it('⚠️ answers a row with no seller side instead of failing the invariant', () => {
    // A refund child row zeroes commission AND payout, as would any
    // first-party sale where All Outdoor is the seller of record. Neither can
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
    const f = deductFacts(800);
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
    expect(feeModelFor({ isExperience: true, isMarkedUpBuyNow: true })).toBe(
      FeeModel.SELLER_DEDUCT,
    );
  });
});
