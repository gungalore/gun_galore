// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SellerPromoBand } from './seller-promo-band';

// ────────────────────────────────────────────────────────────────────
// THE QUALIFIER IS THE ASSERTION THAT MATTERS.
//
// "100% payout" is true on a Buy Now sale: the seller receives their full ask
// and the buyer pays the Platform Fee. It is NOT true on an auction, where the
// seller pays 5% of the hammer out of the payout (AUCTION_SPLIT_RATE; /fees
// §3). A future edit that drops "on Buy Now" turns the homepage into a claim
// the published fee schedule contradicts, so this spec asserts the whole
// sentence rather than the number.
// ────────────────────────────────────────────────────────────────────

describe('SellerPromoBand', () => {
  it('states the offer with the 100% claim scoped to Buy Now', () => {
    render(<SellerPromoBand />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Sellers list for free.');
    expect(heading).toHaveTextContent('100% payout on Buy Now.');
  });

  it('labels its section with that heading', () => {
    const { container } = render(<SellerPromoBand />);
    const section = container.querySelector('section');
    const heading = container.querySelector('#seller-promo-heading');
    expect(section).toHaveAttribute('aria-labelledby', 'seller-promo-heading');
    expect(heading).not.toBeNull();
    expect(section?.contains(heading)).toBe(true);
  });

  it('routes to the sell flow and to the full fee schedule', () => {
    render(<SellerPromoBand />);
    expect(
      screen.getByRole('link', { name: /start selling/i }),
    ).toHaveAttribute('href', '/listings/new');
    expect(screen.getByRole('link', { name: /see fees/i })).toHaveAttribute(
      'href',
      '/fees',
    );
  });

  it('keeps the house copy rules', () => {
    const { container } = render(<SellerPromoBand />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/escrow/i);
    expect(text).not.toMatch(/\bKYC\b/i);
    expect(text).not.toContain('\u2014');
  });
});
