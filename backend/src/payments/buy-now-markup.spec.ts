import { FeeCalculator, MIN_COMMISSION_CENTS } from './fee.calculator';

// MARKETPLACE — operator decision 2026-10.
//
// The seller names what they want to receive and gets exactly that. Their ask
// IS the listed price; the buyer-paid Platform Fee is calculated at checkout
// on (item + delivery). The old Top Seller discount is retired.

const calc = new FeeCalculator();
const R = (rands: number) => Math.round(rands * 100);

describe('listPriceFromSellerAsk', () => {
  it('lists the raw ask — the fee is not baked in', () => {
    // ask R450 → listed R450, estimated fee R45 (10% of the first R25k).
    const m = calc.listPriceFromSellerAsk(R(450));
    expect(m.sellerAsk).toBe(R(450));
    expect(m.commissionZar).toBe(R(45));
    expect(m.listPrice).toBe(R(450));
  });

  it('leaves the seller whole — the ask is the payout', () => {
    for (const ask of [R(50), R(450), R(5000), R(20000), R(100000)]) {
      const b = calc.breakdownBuyNow(ask);
      expect(b.sellerPayout).toBe(ask);
      expect(b.commissionZar).toBe(0);
    }
  });

  it('applies the new 10/9/8/7 bands', () => {
    // R5k: 10% of the first R5,000
    expect(calc.listPriceFromSellerAsk(R(5000)).commissionZar).toBe(R(500));
    // R20k: 10% of the first R25,000
    expect(calc.listPriceFromSellerAsk(R(20000)).commissionZar).toBe(R(2000));
    // R100k: 25k@10 + 25k@9 + 25k@8 + 25k@7
    expect(calc.listPriceFromSellerAsk(R(100000)).commissionZar).toBe(
      R(8500),
    );
  });

  it('honours the R10 minimum on a small ask', () => {
    // 10% of R50 is R5, so the floor lifts it to R10.
    const m = calc.listPriceFromSellerAsk(R(50));
    expect(m.commissionZar).toBe(MIN_COMMISSION_CENTS);
    expect(MIN_COMMISSION_CENTS).toBe(R(10));
    expect(m.listPrice).toBe(R(50));
  });

  it('returns zeroes for a zero ask rather than charging the minimum', () => {
    expect(calc.listPriceFromSellerAsk(0)).toEqual({
      sellerAsk: 0,
      commissionZar: 0,
      listPrice: 0,
    });
  });
});

describe('breakdownBuyNow', () => {
  it('calculates the Platform Fee last, on item + delivery', () => {
    const b = calc.breakdownBuyNow(R(450), R(79), R(15));
    expect(b.listingPrice).toBe(R(450));
    // 10% of (R450 + R79 + R15) = R54.40
    expect(b.processingFee).toBe(5_440);
    expect(b.buyerTotal).toBe(R(450) + R(94) + 5_440);
  });

  it('charges the fee on the delivery figure the buyer sees', () => {
    const b = calc.breakdownBuyNow(R(450), R(79), R(15));
    const onItemAndDelivery = calc.calculatePlatformFee(R(450) + R(94));
    expect(b.processingFee).toBe(onItemAndDelivery);
  });

  it('never deducts anything from the seller', () => {
    for (const ship of [0, R(79), R(500)]) {
      const b = calc.breakdownBuyNow(R(450), ship, R(15));
      expect(b.sellerPayout).toBe(R(450));
      expect(b.commissionZar).toBe(0);
    }
  });
});

describe('multi-buy', () => {
  it('charges the fee once on the line, after quantity', () => {
    const one = calc.breakdownBuyNow(R(450));
    const two = calc.breakdownBuyNow(R(450), 0, 0, 2);
    expect(two.listingPrice).toBe(one.listingPrice * 2);
    expect(two.processingFee).toBe(R(90));
  });

  it('pays the seller their ask for every unit', () => {
    const three = calc.breakdownBuyNow(R(450), 0, 0, 3);
    expect(three.sellerPayout).toBe(R(450) * 3);
  });

  it('treats a zero or negative quantity as one', () => {
    const one = calc.breakdownBuyNow(R(450));
    expect(calc.breakdownBuyNow(R(450), 0, 0, 0)).toEqual(one);
  });
});

describe('auction split', () => {
  it('charges the buyer 5% of (hammer + delivery) and the seller 5% of the hammer', () => {
    const b = calc.breakdownAuction(R(20_000), R(200), 0);
    expect(b.listingPrice).toBe(R(20_000));
    expect(b.processingFee).toBe(R(1_010));
    expect(b.commissionZar).toBe(R(1_000));
    expect(b.sellerPayout).toBe(R(19_000));
    expect(b.buyerTotal).toBe(R(20_000) + R(200) + R(1_010));
  });

  it('floors the buyer fee at R10 on a tiny hammer', () => {
    const b = calc.breakdownAuction(R(50));
    expect(b.processingFee).toBe(MIN_COMMISSION_CENTS);
  });
});
