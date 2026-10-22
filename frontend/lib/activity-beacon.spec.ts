import { describe, expect, it } from 'vitest';
import { listingIdForPath, sectionForPath } from './activity-beacon';

// The section is what the admin "time spent on what" board groups by, and it
// is posted to an UNAUTHENTICATED endpoint. These cases hold the mapping the
// backend allowlist was written against.

describe('sectionForPath', () => {
  it('separates the two live-browse views by their query string', () => {
    expect(sectionForPath('/')).toBe('marketplace');
    expect(sectionForPath('/?listingType=BUY_NOW')).toBe('marketplace');
    expect(sectionForPath('/?listingType=AUCTION')).toBe('auctions');
  });

  it('names each product pillar', () => {
    expect(sectionForPath('/listings/abc123')).toBe('listing');
    expect(sectionForPath('/listings/new')).toBe('listing');
    expect(sectionForPath('/community')).toBe('community');
    expect(sectionForPath('/community/p/abc')).toBe('community');
    expect(sectionForPath('/bench')).toBe('bench');
    expect(sectionForPath('/motivations/123')).toBe('motivations');
    expect(sectionForPath('/value')).toBe('valuations');
    expect(sectionForPath('/checkout/abc')).toBe('checkout');
  });

  it('folds account surfaces together and leaves the rest as other', () => {
    expect(sectionForPath('/dashboard')).toBe('account');
    expect(sectionForPath('/wishlist')).toBe('account');
    expect(sectionForPath('/orders/123')).toBe('account');
    expect(sectionForPath('/faq')).toBe('other');
  });
});

describe('listingIdForPath', () => {
  it('extracts a real listing id and ignores the create route', () => {
    expect(listingIdForPath('/listings/cmvk5efzl000y3avnk4r42rwg')).toBe(
      'cmvk5efzl000y3avnk4r42rwg',
    );
    expect(listingIdForPath('/listings/new')).toBeUndefined();
    expect(listingIdForPath('/listings')).toBeUndefined();
    expect(listingIdForPath('/community')).toBeUndefined();
  });
});
