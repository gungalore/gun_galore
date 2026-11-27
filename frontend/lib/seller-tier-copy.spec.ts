import { describe, expect, it } from 'vitest';
import { SELLER_TIER_TOOLTIP } from './seller-tier-copy';

// ⚠️ THE PROFILE TOOLTIP USED TO ADVERTISE A "Dealer (licensed firearms
// dealer)" tier and promise higher tiers "visibility" — neither is true. No tier
// is awarded as Dealer, and a tier is a display of record only.
describe('the seller-tier tooltip', () => {
  it('names the four real tiers with their thresholds', () => {
    expect(SELLER_TIER_TOOLTIP).toMatch(/New \(just signed up\)/);
    expect(SELLER_TIER_TOOLTIP).toMatch(/Established \(3\+ clean sales/);
    expect(SELLER_TIER_TOOLTIP).toMatch(/Trusted \(10\+ clean sales/);
    expect(SELLER_TIER_TOOLTIP).toMatch(/Top Seller \(25\+ clean sales/);
  });

  it('never mentions Dealer', () => {
    expect(SELLER_TIER_TOOLTIP).not.toMatch(/dealer/i);
  });

  it('never claims visibility or ranking perks', () => {
    expect(SELLER_TIER_TOOLTIP).not.toMatch(/visibilit/i);
    expect(SELLER_TIER_TOOLTIP).not.toMatch(/rank|boost|promot|more buyers/i);
  });

  it('says the tier is a public display of record', () => {
    expect(SELLER_TIER_TOOLTIP).toMatch(/shown publicly on your listings/);
    expect(SELLER_TIER_TOOLTIP).toMatch(/reflects your record only/);
  });
});
