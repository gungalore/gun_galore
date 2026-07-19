import {
  FeeCalculator,
  SWAP_SHIPPING_FEE_CENTS,
  SWAP_FIREARM_FEE_CENTS,
} from './fee.calculator';

describe('FeeCalculator.breakdownSwapLeg', () => {
  const fc = new FeeCalculator();

  it('non-firearm leg, no cash: party pays courier + R50 fee (1.5% absorbed by GG)', () => {
    const b = fc.breakdownSwapLeg(8_000); // R80 courier
    expect(b.courierCost).toBe(8_000);
    expect(b.serviceFee).toBe(SWAP_SHIPPING_FEE_CENTS); // R50
    expect(b.cashContribution).toBe(0);
    expect(b.subtotal).toBe(13_000);
    expect(b.processingFee).toBe(195); // round(13000 * 1.5%) — GG's absorbed cost
    expect(b.partyTotal).toBe(13_000); // member pays subtotal; 1.5% NOT added
  });

  it('adds the cash top-up for the paying party (still no 1.5% on top)', () => {
    const b = fc.breakdownSwapLeg(8_000, 50_000); // + R500 cash
    expect(b.cashContribution).toBe(50_000);
    expect(b.subtotal).toBe(63_000);
    expect(b.processingFee).toBe(945); // absorbed
    expect(b.partyTotal).toBe(63_000);
  });

  it('firearm leg: no courier, flat R100 fee (1.5% absorbed)', () => {
    const b = fc.breakdownSwapLeg(99_999, 0, true); // courier ignored
    expect(b.courierCost).toBe(0);
    expect(b.serviceFee).toBe(SWAP_FIREARM_FEE_CENTS); // R100
    expect(b.subtotal).toBe(10_000);
    expect(b.processingFee).toBe(150); // absorbed
    expect(b.partyTotal).toBe(10_000);
  });

  it('clamps negative inputs to zero', () => {
    const b = fc.breakdownSwapLeg(-500, -10);
    expect(b.courierCost).toBe(0);
    expect(b.cashContribution).toBe(0);
    expect(b.subtotal).toBe(SWAP_SHIPPING_FEE_CENTS);
  });
});

// Monetisation 2026-07-19 — value-based swap service fee: 1.5% of the
// sender's declared value, clamped [leg minimum, R750], PRO −25%.
describe('FeeCalculator.swapServiceFee (value-based)', () => {
  const fc = new FeeCalculator();

  it('floors at R50 for a courier leg with a small declared value', () => {
    // 1.5% of R1,000 = R15 → floored to the R50 minimum.
    expect(fc.swapServiceFee(100_000)).toBe(SWAP_SHIPPING_FEE_CENTS);
  });

  it('charges 1.5% of the declared value in the linear band', () => {
    // 1.5% of R10,000 = R150.
    expect(fc.swapServiceFee(1_000_000)).toBe(15_000);
  });

  it('caps at R750 for high-value items', () => {
    // 1.5% of R100,000 = R1,500 → capped at R750.
    expect(fc.swapServiceFee(10_000_000)).toBe(75_000);
  });

  it('floors at R100 for a firearm leg', () => {
    // 1.5% of R2,000 = R30 → firearm floor R100.
    expect(fc.swapServiceFee(200_000, true)).toBe(SWAP_FIREARM_FEE_CENTS);
  });

  it('applies the 25% PRO discount after the clamp', () => {
    // R150 base → R112.50 → rounds to 11250c.
    expect(fc.swapServiceFee(1_000_000, false, true)).toBe(11_250);
    // Capped R750 → R562.50 for PRO.
    expect(fc.swapServiceFee(10_000_000, false, true)).toBe(56_250);
  });

  it('legacy zero declared value falls back to the flat leg minimum', () => {
    expect(fc.swapServiceFee(0)).toBe(SWAP_SHIPPING_FEE_CENTS);
    expect(fc.swapServiceFee(0, true)).toBe(SWAP_FIREARM_FEE_CENTS);
  });

  it('breakdownSwapLeg threads declared value + PRO through to serviceFee', () => {
    const b = fc.breakdownSwapLeg(8_000, 0, false, 'manual', 1_000_000, true);
    expect(b.serviceFee).toBe(11_250);
    expect(b.partyTotal).toBe(8_000 + 11_250);
  });
});
