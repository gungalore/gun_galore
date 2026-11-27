import { describe, expect, it } from 'vitest';
import { sellerApiPaths, sellerPageHref } from './seller-storefront';

// ⚠️ THE BUG THIS PINS: the storefront fetched and linked with the VIEWER's id.
// A signed-in visitor saw their own header/reviews under somebody else's URL; a
// signed-out visitor asked for `/sellers/undefined` and 404'd. Both fetch paths
// and every generated link must be built from the SELLER's route id.
describe('the seller storefront’s URLs', () => {
  it('fetches the seller’s profile and reviews by the route id', () => {
    expect(sellerApiPaths('seller-123')).toEqual({
      profile: '/sellers/seller-123',
      ratings: '/ratings/seller/seller-123',
    });
  });

  it('builds page links from the seller id, never the viewer', () => {
    const href = sellerPageHref('seller-123', {}, 3);
    expect(href).toBe('/sellers/seller-123?page=3');
    // A viewer id cannot leak in: the helper only takes the route id.
    expect(href).not.toContain('viewer');
  });

  it('carries the active browse filters and overrides the page', () => {
    const href = sellerPageHref(
      'seller-123',
      {
        categoryId: 'cat-1',
        condition: 'GOOD',
        make: 'Beretta',
        minPrice: '1000',
        maxPrice: '9000',
        sort: 'price_asc',
        page: '2',
        attrs: 'calibre%3A9mm',
      },
      4,
    );
    const url = new URL(`https://x.test${href}`);
    expect(url.pathname).toBe('/sellers/seller-123');
    expect(url.searchParams.get('categoryId')).toBe('cat-1');
    expect(url.searchParams.get('make')).toBe('Beretta');
    expect(url.searchParams.get('page')).toBe('4');
  });

  it('drops unset filters rather than writing "undefined" into a link', () => {
    const href = sellerPageHref('seller-123', { make: undefined, sort: '' }, 1);
    expect(href).toBe('/sellers/seller-123?page=1');
    expect(href).not.toContain('undefined');
  });
});
