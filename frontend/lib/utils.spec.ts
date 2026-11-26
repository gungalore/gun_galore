import { describe, expect, it } from 'vitest';
import { discountPercent, formatPrice } from './utils';

// ────────────────────────────────────────────────────────────────────
// The money formatter every summary line uses. Two jobs and they pull in
// opposite directions: match the design boards' grouping and never round a
// cent-bearing amount away. The old formatter did the first and failed the
// second — an auction hammer of R 8,500.50 printed "R 8,500" next to a bid
// stepper reading "R 8,500.50", so the page did not foot (audit L7).
//
// ⚠️ THE EXPECTED STRINGS ARE BUILT WITH THE SAME LOCALE, NOT TYPED OUT.
// `en-ZA` grouping/decimal separators come from the ICU build the code runs
// on, not from this repo (current Node renders "R 12 345,00"; other ICU builds
// use commas and dots). A hand-typed "R 8,500.50" here would test the test
// runner's ICU, not the rule. The rule — whole rands stay whole, cents always
// get exactly two digits — is what is asserted.
// ────────────────────────────────────────────────────────────────────

function wholeRands(value: number): string {
  return value.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function withCents(value: number): string {
  return value.toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

describe('formatPrice', () => {
  it('keeps whole rands exactly as the design boards write them', () => {
    expect(formatPrice(850_000)).toBe(`R ${wholeRands(8_500)}`);
    expect(formatPrice(0)).toBe('R 0');
    expect(formatPrice(100)).toBe('R 1');
    expect(formatPrice(1_234_500)).toBe(`R ${wholeRands(12_345)}`);
  });

  it('renders two decimals when the amount carries cents', () => {
    expect(formatPrice(850_050)).toBe(`R ${withCents(8_500.5)}`);
    expect(formatPrice(850_001)).toBe(`R ${withCents(8_500.01)}`);
    expect(formatPrice(850_099)).toBe(`R ${withCents(8_500.99)}`);
    expect(formatPrice(50)).toBe(`R ${withCents(0.5)}`);
  });

  it('groups thousands and never rounds cents into whole rands', () => {
    // The rounding failure the old formatter had: 99999c is R999.99, never
    // R1,000, and 1234567c is R12,345.67, never R12,346.
    expect(formatPrice(99_999)).toBe(`R ${withCents(999.99)}`);
    expect(formatPrice(999_999)).toBe(`R ${withCents(9_999.99)}`);
    expect(formatPrice(1_234_567)).toBe(`R ${withCents(12_345.67)}`);
    expect(formatPrice(99_999)).not.toBe(formatPrice(100_000));
  });
});

describe('discountPercent', () => {
  it('stays inside the anti-anchoring cap', () => {
    expect(discountPercent(100, 1_000)).toBe(70);
  });

  it('says nothing when there is no valid discount', () => {
    expect(discountPercent(null, 1_000)).toBeNull();
    expect(discountPercent(100, null)).toBeNull();
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(100, 50)).toBeNull();
  });
});
