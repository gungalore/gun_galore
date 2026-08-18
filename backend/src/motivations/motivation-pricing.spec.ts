import { SubscriptionTier } from '@prisma/client';
import {
  formatPrice,
  MOTIVATION_DISCOUNT_CENTS,
  MOTIVATION_PRICE_CENTS,
  priceMotivation,
  PRICE_REASON_COPY,
} from './motivation-pricing';

// The whole table, cell by cell. It is four outcomes and they are worth up to
// R199 each, so every one is asserted rather than inferred from the two levers.

const price = (tier: SubscriptionTier, firearmBoughtOnSite: boolean) =>
  priceMotivation({ tier, firearmBoughtOnSite });

describe('the price table', () => {
  it('charges R199 with neither lever', () => {
    const p = price(SubscriptionTier.FREE, false);
    expect(p.cents).toBe(19_900);
    expect(p.reason).toBe('standard');
    expect(p.free).toBe(false);
    expect(p.savedCents).toBe(0);
  });

  it('charges R99 for an AO Pro member', () => {
    const p = price(SubscriptionTier.PRO, false);
    expect(p.cents).toBe(9_900);
    expect(p.reason).toBe('pro_subscription');
    expect(p.savedCents).toBe(10_000);
  });

  it('charges R99 when the firearm was bought here', () => {
    const p = price(SubscriptionTier.FREE, true);
    expect(p.cents).toBe(9_900);
    expect(p.reason).toBe('firearm_bought_here');
  });

  it('is FREE for an AO Pro member on a firearm bought here', () => {
    const p = price(SubscriptionTier.PRO, true);
    expect(p.cents).toBe(0);
    expect(p.free).toBe(true);
    expect(p.reason).toBe('pro_and_firearm_bought_here');
    expect(p.savedCents).toBe(19_900);
  });

  it('does not stack the two levers into a negative or a double discount', () => {
    // Both levers reach the same R99 on their own; together they reach zero and
    // stop. Nothing here may ever produce a credit.
    for (const tier of Object.values(SubscriptionTier)) {
      for (const bought of [true, false]) {
        const p = price(tier, bought);
        expect(p.cents).toBeGreaterThanOrEqual(0);
        expect(p.cents).toBeLessThanOrEqual(MOTIVATION_PRICE_CENTS);
        expect([0, MOTIVATION_DISCOUNT_CENTS, MOTIVATION_PRICE_CENTS]).toContain(
          p.cents,
        );
      }
    }
  });

  it('treats a retired MEMBER tier as unsubscribed, not as Pro', () => {
    // MEMBER was retired in favour of PRO. A stale row must fall to the full
    // price rather than quietly inherit a Pro benefit.
    expect(price(SubscriptionTier.MEMBER, false).cents).toBe(
      MOTIVATION_PRICE_CENTS,
    );
    expect(price(SubscriptionTier.MEMBER, true).cents).toBe(
      MOTIVATION_DISCOUNT_CENTS,
    );
  });

  it('marks free as free rather than as a zero charge', () => {
    // A 0.00 authorisation would be rejected by the paygate and would show a
    // member a failed payment for something they are entitled to.
    expect(price(SubscriptionTier.PRO, true).free).toBe(true);
    expect(price(SubscriptionTier.PRO, false).free).toBe(false);
  });
});

describe('how it is explained', () => {
  it('has copy for every reason', () => {
    for (const tier of Object.values(SubscriptionTier)) {
      for (const bought of [true, false]) {
        const p = price(tier, bought);
        expect(PRICE_REASON_COPY[p.reason]).toBeTruthy();
      }
    }
  });

  it('never promises an outcome in the price copy', () => {
    const text = Object.values(PRICE_REASON_COPY).join(' ').toLowerCase();
    for (const banned of ['approv', 'chance', 'guarantee', 'success', 'likely']) {
      expect(text).not.toContain(banned);
    }
  });

  it('formats whole rands, and says Free rather than R0', () => {
    expect(formatPrice(19_900)).toBe('R199');
    expect(formatPrice(9_900)).toBe('R99');
    expect(formatPrice(0)).toBe('Free');
  });

  it('undercuts what the market charges, in every cell', () => {
    // The cheapest fly-by-night writer found was R450. If a change ever put a
    // cell above that, the commercial argument is gone and this should fail.
    for (const tier of Object.values(SubscriptionTier)) {
      for (const bought of [true, false]) {
        expect(price(tier, bought).cents).toBeLessThan(45_000);
      }
    }
  });
});
