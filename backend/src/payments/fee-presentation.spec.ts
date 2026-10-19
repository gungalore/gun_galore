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
// Operator 2026-10: the buyer pays a single Platform Fee at checkout. On a
// marketplace sale the seller receives their full ask and pays nothing; on an
// auction the seller's 5% comes off the hammer. Every fixture is built by the
// REAL FeeCalculator, so these tests fail if the arithmetic and the
// presentation ever drift apart.
// ────────────────────────────────────────────────────────────────────

const fees = new FeeCalculator();

const SHIP = 7_744; // a real Bob Go door rate, R77.44
const HANDLING = 774; // our 10% delivery margin on it

/** A marketplace BUY NOW: seller asks R450 and receives R450. */
function markupFacts(askCents = 45_000, quantity = 1): FeeFacts {
  const b = fees.breakdownBuyNow(askCents, SHIP, HANDLING, quantity);
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

/** An auction win. */
function deductFacts(hammerCents = 45_000): FeeFacts {
  const b = fees.breakdownAuction(hammerCents, SHIP, HANDLING);
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
      markupFacts(5_000), // small ticket, where the R10 fee floor bites
      deductFacts(45_000),
      deductFacts(2_500_000), // crosses three fee bands
    ]) {
      const b = buyerBreakdown(f);
      expect(b.balances).toBe(true);
      expect(total(b.lines)).toBe(b.total);
      expect(b.total).toBe(f.buyerTotal);
    }
  });

  it('⚠️ shows one Platform Fee line — under BOTH models', () => {
    for (const f of [markupFacts(), deductFacts()]) {
      const b = buyerBreakdown(f);
      expect(labels(b.lines)).toContain('Platform Fee');
      expect(labels(b.lines)).not.toContain('Buyer Protection Fee');
      expect(total(b.lines)).toBe(f.buyerTotal);
    }
  });

  it('⚠️ shows delivery as ONE figure, never splitting out our margin', () => {
    const f = markupFacts();
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).not.toContain('Handling');
    const delivery = b.lines.find((l) => l.label === 'Delivery');
    expect(delivery?.cents).toBe(f.shippingCost + f.shippingHandlingCents);
  });

  it('drops the delivery line entirely when there is none', () => {
    // A firearm dealer transfer or a collection books no waybill. The
    // Platform Fee still applies — it is on the item.
    const f = { ...markupFacts(), shippingCost: 0, shippingHandlingCents: 0 };
    f.buyerTotal = f.listingPrice + f.processingFee;
    const b = buyerBreakdown(f);
    expect(labels(b.lines)).toEqual(['Item price', 'Platform Fee']);
    expect(b.balances).toBe(true);
  });
});

describe('what the seller is shown', () => {
  it('shows NO deduction on a marketplace sale', () => {
    const f = markupFacts();
    const s = sellerBreakdown(f);
    expect(s.deductions).toEqual([]);
    expect(s.gross).toBe(f.listingPrice);
    expect(s.net).toBe(f.sellerPayout);
    expect(s.balances).toBe(true);
    expect(s.note).toContain('full asking price');
  });

  it('shows the 5% commission deduction on an auction', () => {
    const f = deductFacts();
    const s = sellerBreakdown(f);
    expect(labels(s.deductions)).toEqual(['Platform Fee']);
    expect(s.deductions[0].cents).toBe(f.commissionZar);
    expect(s.net).toBe(f.sellerPayout);
    expect(s.balances).toBe(true);
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
    const f = { ...deductFacts(), commissionZar: 0, sellerPayout: 0 };
    const s = sellerBreakdown(f);
    expect(s.net).toBe(0);
    expect(s.balances).toBe(true);
    expect(s.note).toBe('This sale has no seller payout.');
  });

  it('handles the auction commission swallowing a tiny sale whole', () => {
    const f = deductFacts(800);
    const s = sellerBreakdown(f);
    expect(s.balances).toBe(true);
    expect(s.note).not.toBe('This sale has no seller payout.');
  });
});

describe('choosing the model', () => {
  it('marks a marketplace sale as the buyer-paid model', () => {
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
