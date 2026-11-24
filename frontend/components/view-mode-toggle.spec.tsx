// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ViewModeToggle } from './view-mode-toggle';

// Three links, not the old Shop/Community pill. The active link is the one
// carrying aria-current="page"; the query-string check is what tells the
// auction surface apart from the bare landing page.

const nav = vi.hoisted(() => ({ path: '/', search: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/lib/motivation-busy', () => ({
  useMotivationBusy: () => false,
}));

beforeEach(() => {
  nav.path = '/';
  nav.search = '';
});

function currentLink(): HTMLElement | null {
  return document.querySelector('a[aria-current="page"]');
}

describe('ViewModeToggle', () => {
  it('renders exactly the three destinations and no Shop label', () => {
    render(<ViewModeToggle />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Marketplace',
      'Auction',
      'Community',
    ]);
    expect(
      screen.getByRole('link', { name: 'Marketplace' }).getAttribute('href'),
    ).toBe('/?listingType=BUY_NOW');
    expect(
      screen.getByRole('link', { name: 'Auction' }).getAttribute('href'),
    ).toBe('/?listingType=AUCTION');
    expect(
      screen.getByRole('link', { name: 'Community' }).getAttribute('href'),
    ).toBe('/community');
    expect(screen.queryByRole('link', { name: 'Shop' })).toBeNull();
  });

  it('marks Marketplace active on the shop landing page', () => {
    render(<ViewModeToggle />);
    expect(currentLink()?.textContent).toBe('Marketplace');
  });

  it('marks Auction active when the auction surface is in the query', () => {
    nav.search = 'listingType=AUCTION';
    render(<ViewModeToggle />);
    return waitFor(() => {
      expect(currentLink()?.textContent).toBe('Auction');
    });
  });

  it('marks Community active on the community feed', () => {
    nav.path = '/community';
    render(<ViewModeToggle />);
    return waitFor(() => {
      expect(currentLink()?.textContent).toBe('Community');
    });
  });
});
