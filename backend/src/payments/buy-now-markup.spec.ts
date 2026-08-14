import { FeeCalculator, MIN_COMMISSION_CENTS } from './fee.calculator';

// BUY NOW markup — operator decision 2026-08-15.
//
// The seller names what they want to receive and gets exactly that. Our
// commission and the Peach fee are built INTO the listed price instead of
// deducted from the seller, so the number on the card is the number the buyer
// pays. Same percentages as before, applied in the opposite direction.

const calc = new FeeCalculator();
const R = (rands: number) => Math.round(rands * 100);

describe('listPriceFromSellerAsk', () => {
  it('builds the worked example exactly', () => {
    // ask R450 → +9% = R490.50 → +Peach on THAT = R511.97
    const m = calc.listPriceFromSellerAsk(R(450), false);
    expect(m.sellerAsk).toBe(R(450));
    expect(m.commissionZar).toBe(R(40.5));
    expect(m.processingFee).toBe(R(21.47));
    expect(m.listPrice).toBe(R(511.97));
  });

  it('charges Peach on the COMMISSION-INCLUSIVE subtotal, not the bare ask', () => {
    // That is what the operator specified: "if we charge 9% we add 4.03% to
    // that total". Charging it on the ask alone would under-recover further.
    const m = calc.listPriceFromSellerAsk(R(450), false);
    const onAskOnly = calc.calculateProcessingFee(R(450));
    expect(m.processingFee).toBeGreaterThan(onAskOnly);
  });

  it('leaves the seller whole — the ask is the payout', () => {
    for (const ask of [R(50), R(450), R(5000), R(20000), R(100000)]) {
      const b = calc.breakdownBuyNow(ask, false);
      expect(b.sellerPayout).toBe(ask);
    }
  });

  it('keeps the banded percentages unchanged', () => {
    // Bands apply to the seller's ask exactly as they applied to the old
    // listing price — only the direction of the money changed.
    expect(calc.listPriceFromSellerAsk(R(5000), false).commissionZar).toBe(R(450));
    // R20k: 9% of first 5k + 7% of next 15k = 450 + 1050
    expect(calc.listPriceFromSellerAsk(R(20000), false).commissionZar).toBe(R(1500));
    // R100k: 450 + 1050 + 5% of 80k
    expect(calc.listPriceFromSellerAsk(R(100000), false).commissionZar).toBe(R(5500));
  });

  it('still honours the R30 minimum on a small ask', () => {
    // 9% of R50 is R4.50 — the floor lifts it to R30, so a cheap item carries
    // a visibly large markup. That is the floor working, not a bug.
    const m = calc.listPriceFromSellerAsk(R(50), false);
    expect(m.commissionZar).toBe(MIN_COMMISSION_CENTS);
    expect(m.listPrice).toBeGreaterThan(R(80));
  });

  it('passes the Top Seller discount on to the BUYER as a lower price', () => {
    // Under the old model the discount raised the seller's payout. Now the
    // seller already gets 100%, so it can only show up as a cheaper listing —
    // which is a better shop-window position for that seller.
    const plain = calc.listPriceFromSellerAsk(R(5000), false);
    const top = calc.listPriceFromSellerAsk(R(5000), true);
    expect(top.listPrice).toBeLessThan(plain.listPrice);
    expect(top.sellerAsk).toBe(plain.sellerAsk);
  });

  it('returns zeroes for a zero ask rather than charging the minimum', () => {
    expect(calc.listPriceFromSellerAsk(0, false)).toEqual({
      sellerAsk: 0,
      commissionZar: 0,
      processingFee: 0,
      listPrice: 0,
    });
  });
});

describe('breakdownBuyNow', () => {
  it('adds nothing at checkout but shipping and the handling margin', () => {
    const b = calc.breakdownBuyNow(R(450), false, R(79), 'paygate', R(15));
    expect(b.listingPrice).toBe(R(511.97));
    expect(b.buyerTotal).toBe(R(511.97) + R(79) + R(15));
    // Crucially: NO processing fee added on top — it is already inside the
    // listed price. Adding it here would double-charge the buyer.
    expect(b.buyerTotal).not.toBe(R(511.97) + R(79) + R(15) + b.processingFee);
  });

  it('the buyer pays the listed price for the goods, full stop', () => {
    const m = calc.listPriceFromSellerAsk(R(1200), false);
    const b = calc.breakdownBuyNow(R(1200), false);
    expect(b.buyerTotal).toBe(m.listPrice);
  });

  it('our margin is the commission; Peach takes the rest of the markup', () => {
    const b = calc.breakdownBuyNow(R(450), false);
    const markup = b.listingPrice - b.sellerPayout;
    expect(markup).toBe(b.commissionZar + b.processingFee);
  });

  it('never pays out more than the seller asked, whatever the shipping', () => {
    for (const ship of [0, R(79), R(500)]) {
      const b = calc.breakdownBuyNow(R(450), false, ship, 'paygate', R(15));
      expect(b.sellerPayout).toBe(R(450));
    }
  });

  it('recovers less than Peach eventually charges — the known residual', () => {
    // Peach bills its percentage on the FINAL amount, not the subtotal we
    // marked up. This pins the size of that leak so it cannot drift unnoticed.
    const b = calc.breakdownBuyNow(R(450), false);
    const actuallyCharged = calc.calculateProcessingFee(b.listingPrice);
    const shortfall = actuallyCharged - b.processingFee;
    expect(shortfall).toBeGreaterThan(0);
    expect(shortfall).toBeLessThan(R(1)); // ~R0.86 on a R450 ask
  });
});

describe('multi-buy matches the price on the card', () => {
  it('charges exactly twice the listed price for two units', () => {
    // The listed price is a promise. If the line were re-banded, the second
    // unit would fall into a cheaper band and the R30 floor would be charged
    // once, so two would cost LESS than twice the card price — and the card
    // would be lying.
    const one = calc.breakdownBuyNow(R(450), false);
    const two = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 2);
    expect(two.listingPrice).toBe(one.listingPrice * 2);
    expect(two.buyerTotal).toBe(one.buyerTotal * 2);
  });

  it('pays the seller their ask for every unit', () => {
    const three = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 3);
    expect(three.sellerPayout).toBe(R(450) * 3);
  });

  it('scales our margin per unit too', () => {
    const two = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 2);
    expect(two.commissionZar).toBe(R(40.5) * 2);
  });

  it('treats a zero or negative quantity as one', () => {
    const one = calc.breakdownBuyNow(R(450), false);
    expect(calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 0)).toEqual(one);
  });
});
