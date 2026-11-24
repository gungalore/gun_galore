// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SellerPromoHeadline } from './seller-promo-headline';

// ────────────────────────────────────────────────────────────────────
// THE WORD SPLIT MUST NOT CHANGE THE SENTENCE.
//
// The headline is broken into eight inline-block spans so each word can fly in.
// That is exactly the kind of markup that quietly drops the spaces between
// words or welds the two sentences together, so the assertions below compare
// the normalised text, not a substring.
//
// THE FIRST TEST MUST RUN FIRST. The once-per-launch flag is module state; by
// the time it finishes, the intro has "played" and later renders are at rest.
// That is the behaviour under test, not a leak between tests.
// ────────────────────────────────────────────────────────────────────

describe('SellerPromoHeadline', () => {
  it('plays the intro once, then renders at rest', () => {
    const first = render(<SellerPromoHeadline />);
    expect(first.container.querySelector('h2')).toHaveAttribute(
      'data-intro',
      'play',
    );
    first.unmount();

    const second = render(<SellerPromoHeadline />);
    expect(second.container.querySelector('h2')).toHaveAttribute(
      'data-intro',
      'off',
    );
  });

  it('renders the statement with its spaces and both sentences intact', () => {
    const { container } = render(<SellerPromoHeadline />);
    const heading = screen.getByRole('heading', { level: 2 });

    expect(heading).toHaveAttribute('id', 'seller-promo-heading');
    expect(
      heading.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('Sellers list for free. 100% payout on Marketplace.');

    const words = container.querySelectorAll('.gg-word');
    expect(words).toHaveLength(8);
  });

  it('keeps "100% payout" in brand red and the qualifier in ink', () => {
    const { container } = render(<SellerPromoHeadline />);
    const redWords = Array.from(container.querySelectorAll('.gg-word')).filter(
      (el) => (el.getAttribute('style') ?? '').includes('--red'),
    );

    expect(redWords.map((el) => el.textContent)).toEqual(['100%', 'payout']);
  });
});
