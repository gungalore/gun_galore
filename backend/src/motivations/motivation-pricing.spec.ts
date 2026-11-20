import { formatPrice, MOTIVATION_PRICE_CENTS } from './motivation-pricing';

// One price, and nothing that can produce a second one. The August discount
// table was never wired and is gone — see the note in motivation-pricing.ts.

describe('the motivation price', () => {
  it('is R295', () => {
    expect(MOTIVATION_PRICE_CENTS).toBe(29_500);
    expect(formatPrice(MOTIVATION_PRICE_CENTS)).toBe('R295');
  });

  it('formats whole rands', () => {
    expect(formatPrice(100)).toBe('R1');
    expect(formatPrice(29_500)).toBe('R295');
    expect(formatPrice(299_900)).toBe('R2999');
  });

  it('says Free rather than R0', () => {
    // No caller may ever ask the gateway for a 0.00 authorisation; this is the
    // one string that keeps "nothing to pay" readable if a zero ever reaches
    // a screen.
    expect(formatPrice(0)).toBe('Free');
  });

  it('stays under what the market charges', () => {
    // Fly-by-night writers were quoted R450-R1,000. The commercial argument is
    // that R295 undercuts them; a change that breaks this should be deliberate.
    expect(MOTIVATION_PRICE_CENTS).toBeLessThan(45_000);
  });
});
