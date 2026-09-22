// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CommunityGate } from './community-gate';

/**
 * The gate is the ONLY thing an anonymous visitor (human or crawler) sees on
 * /community. The assertions that matter are the negative ones: it must never
 * render member content, and it must route to sign-in while preserving the
 * destination.
 */
describe('CommunityGate', () => {
  it('invites the visitor to sign in', () => {
    render(<CommunityGate />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/sign in/i);
    expect(text).toMatch(/community/i);
  });

  it('links to sign-in and sign-up with the feed as the redirect target', () => {
    const { container } = render(<CommunityGate />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.some((h) => h?.startsWith('/sign-in'))).toBe(true);
    expect(hrefs.some((h) => h?.includes('redirect_url=/community'))).toBe(true);
  });

  it('shows no member post content', () => {
    const { container } = render(<CommunityGate />);
    expect(container.querySelector('article')).toBeNull();
  });
});
