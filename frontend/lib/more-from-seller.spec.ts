import { describe, expect, it } from 'vitest';
import {
  MORE_FROM_SELLER_LIMIT,
  moreFromSeller,
  showsMoreFromSeller,
} from './more-from-seller';

const card = (id: string) => ({ id, title: id });

// ⚠️ THE SECTION SELF-HIDES. Nothing else to show → no heading, no empty grid.
describe('more listings from this seller', () => {
  it('excludes the listing being viewed', () => {
    expect(
      moreFromSeller([card('a'), card('b'), card('c')], 'b').map((l) => l.id),
    ).toEqual(['a', 'c']);
  });

  it('caps the row at four', () => {
    const listings = ['a', 'b', 'c', 'd', 'e', 'f'].map(card);
    expect(moreFromSeller(listings, 'a')).toHaveLength(
      MORE_FROM_SELLER_LIMIT,
    );
    expect(moreFromSeller(listings, 'a').map((l) => l.id)).toEqual([
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('hides itself when the seller has nothing else', () => {
    expect(showsMoreFromSeller([card('a')], 'a')).toBe(false);
    expect(showsMoreFromSeller([], 'a')).toBe(false);
    expect(showsMoreFromSeller(null, 'a')).toBe(false);
    expect(showsMoreFromSeller(undefined, 'a')).toBe(false);
  });

  it('shows itself once there is one other listing', () => {
    expect(showsMoreFromSeller([card('a'), card('b')], 'a')).toBe(true);
  });
});
