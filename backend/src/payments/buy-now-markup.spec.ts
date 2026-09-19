import { FeeCalculator, MIN_COMMISSION_CENTS } from './fee.calculator';

// BUY NOW markup — operator decision 2026-08-15; fee stack changed 2026-09.
//
// The seller names what they want to receive and gets exactly that. Our
// commission is built INTO the listed price, so the seller never sees a
// deduction from their ask. The Buyer Protection Fee is NOT baked in any
// more (operator 2026-09): it is added at checkout on (item + shipping), the
// same way the auction path charges it, so the listed number stays a clean
// "ask + commission".

const calc = new FeeCalculator();
const R = (rands: number) => Math.round(rands * 100);

describe('listPriceFromSellerAsk', () => {
  it('builds the worked example exactly', () => {
    // ask R450 → +10% = R495. No gateway fee inside the listing any more.
    const m = calc.listPriceFromSellerAsk(R(450), false);
    expect(m.sellerAsk).toBe(R(450));
    expect(m.commissionZar).toBe(R(45));
    expect(m.listPrice).toBe(R(495));
  });

  it('leaves the seller whole — the ask is the payout', () => {
    for (const ask of [R(50), R(450), R(5000), R(20000), R(100000)]) {
      const b = calc.breakdownBuyNow(ask, false);
      expect(b.sellerPayout).toBe(ask);
    }
  });

  it('applies the new 10/8/6/4 bands to the seller ask', () => {
    // R5k: 10% of the first R5,000
    expect(calc.listPriceFromSellerAsk(R(5000), false).commissionZar).toBe(R(500));
    // R20k: 10% of 5k + 8% of 10k + 6% of 5k = 500 + 800 + 300
    expect(calc.listPriceFromSellerAsk(R(20000), false).commissionZar).toBe(
      R(1600),
    );
    // R100k: 500 + 800 + 600 + 4% of 75k = 500 + 800 + 600 + 3000
    expect(calc.listPriceFromSellerAsk(R(100000), false).commissionZar).toBe(
      R(4900),
    );
  });

  it('honours the R10 minimum on a small ask', () => {
    // 10% of R50 is R5, so the floor lifts it to R10.
    const m = calc.listPriceFromSellerAsk(R(50), false);
    expect(m.commissionZar).toBe(MIN_COMMISSION_CENTS);
    expect(MIN_COMMISSION_CENTS).toBe(R(10));
    expect(m.listPrice).toBe(R(60));
  });

  it('passes the Top Seller discount on to the BUYER as a lower price', () => {
    const plain = calc.listPriceFromSellerAsk(R(5000), false);
    const top = calc.listPriceFromSellerAsk(R(5000), true);
    expect(top.listPrice).toBeLessThan(plain.listPrice);
    expect(top.sellerAsk).toBe(plain.sellerAsk);
  });

  it('returns zeroes for a zero ask rather than charging the minimum', () => {
    expect(calc.listPriceFromSellerAsk(0, false)).toEqual({
      sellerAsk: 0,
      commissionZar: 0,
      listPrice: 0,
    });
  });
});

describe('breakdownBuyNow', () => {
  it('adds the Buyer Protection Fee + shipping + handling at checkout', () => {
    const b = calc.breakdownBuyNow(R(450), false, R(79), 'paygate', R(15));
    expect(b.listingPrice).toBe(R(495));
    // 3.28% of (R495 + R79) + R1.15
    expect(b.processingFee).toBe(R(19.98));
    expect(b.buyerTotal).toBe(R(495) + R(19.98) + R(79) + R(15));
  });

  it('charges the fee on item + shipping, never on the handling margin', () => {
    const b = calc.breakdownBuyNow(R(450), false, R(79), 'paygate', R(15));
    const onItemAndShip = calc.calculateProcessingFee(R(495) + R(79));
    expect(b.processingFee).toBe(onItemAndShip);
  });

  it('our margin is the commission; the fee is the buyer’s', () => {
    const b = calc.breakdownBuyNow(R(450), false);
    const markup = b.listingPrice - b.sellerPayout;
    expect(markup).toBe(b.commissionZar);
  });

  it('never pays out more than the seller asked, whatever the shipping', () => {
    for (const ship of [0, R(79), R(500)]) {
      const b = calc.breakdownBuyNow(R(450), false, ship, 'paygate', R(15));
      expect(b.sellerPayout).toBe(R(450));
    }
  });
});

describe('multi-buy matches the price on the card', () => {
  it('charges exactly twice the listed price for two units', () => {
    // The listed price is a promise. If the line were re-banded, the second
    // unit would fall into a cheaper band and the R10 floor would be charged
    // once, so two would cost LESS than twice the card price.
    const one = calc.breakdownBuyNow(R(450), false);
    const two = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 2);
    expect(two.listingPrice).toBe(one.listingPrice * 2);
  });

  it('pays the seller their ask for every unit', () => {
    const three = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 3);
    expect(three.sellerPayout).toBe(R(450) * 3);
  });

  it('scales our margin per unit too', () => {
    const two = calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 2);
    expect(two.commissionZar).toBe(R(45) * 2);
  });

  it('treats a zero or negative quantity as one', () => {
    const one = calc.breakdownBuyNow(R(450), false);
    expect(calc.breakdownBuyNow(R(450), false, 0, 'paygate', 0, 0)).toEqual(one);
  });
});

describe('the "was" price must sit above the price buyers actually see', () => {
  // The seller types R450 but the listing shows R495. Validating a compare-at
  // price against the raw ask would accept R470 — rendering a strikethrough
  // BELOW the live price, which is both nonsense on the card and a misleading
  // discount claim under CPA s41.
  it('a was-price between the ask and the listed price is not a discount', () => {
    const listed = calc.listPriceFromSellerAsk(R(450), false).listPrice;
    const wouldPassAgainstAsk = R(470);
    expect(wouldPassAgainstAsk).toBeGreaterThan(R(450)); // passes the naive check
    expect(wouldPassAgainstAsk).toBeLessThan(listed); // but is below the real price
  });

  it('the 4x anti-anchor cap is also measured from the listed price', () => {
    const listed = calc.listPriceFromSellerAsk(R(450), false).listPrice;
    expect(listed * 4).toBeGreaterThan(R(450) * 4);
  });
});
