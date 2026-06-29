import {
  FeeCalculator,
  SWAP_SHIPPING_FEE_CENTS,
  SWAP_FIREARM_FEE_CENTS,
} from './fee.calculator';

describe('FeeCalculator.breakdownSwapLeg', () => {
  const fc = new FeeCalculator();

  it('non-firearm leg, no cash: courier + R50 fee + 1.5% manual handling', () => {
    const b = fc.breakdownSwapLeg(8_000); // R80 courier
    expect(b.courierCost).toBe(8_000);
    expect(b.serviceFee).toBe(SWAP_SHIPPING_FEE_CENTS); // R50
    expect(b.cashContribution).toBe(0);
    expect(b.subtotal).toBe(13_000);
    expect(b.processingFee).toBe(195); // round(13000 * 1.5%)
    expect(b.partyTotal).toBe(13_195);
  });

  it('adds the cash top-up for the paying party', () => {
    const b = fc.breakdownSwapLeg(8_000, 50_000); // + R500 cash
    expect(b.cashContribution).toBe(50_000);
    expect(b.subtotal).toBe(63_000);
    expect(b.processingFee).toBe(945);
    expect(b.partyTotal).toBe(63_945);
  });

  it('firearm leg: no courier, flat R100 handling fee', () => {
    const b = fc.breakdownSwapLeg(99_999, 0, true); // courier ignored
    expect(b.courierCost).toBe(0);
    expect(b.serviceFee).toBe(SWAP_FIREARM_FEE_CENTS); // R100
    expect(b.subtotal).toBe(10_000);
    expect(b.processingFee).toBe(150);
    expect(b.partyTotal).toBe(10_150);
  });

  it('clamps negative inputs to zero', () => {
    const b = fc.breakdownSwapLeg(-500, -10);
    expect(b.courierCost).toBe(0);
    expect(b.cashContribution).toBe(0);
    expect(b.subtotal).toBe(SWAP_SHIPPING_FEE_CENTS);
  });
});
