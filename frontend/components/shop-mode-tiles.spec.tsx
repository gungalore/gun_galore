// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ShopModeBar } from './shop-mode-tiles';

// ────────────────────────────────────────────────────────────────────
// The bar is a set of static boxes with explicit actions, not clickable tiles.
// The assertions that matter:
//   * it still hides on fine-print/checkout routes;
//   * the box surface is never a link or button;
//   * the Armory disclosure is opened by its button and closes with the page;
//   * the public licence-motivation entry is present and points at the neutral
//     public page signed out, directly at the application signed in.
// ────────────────────────────────────────────────────────────────────

const nav = vi.hoisted(() => ({ path: '/' }));
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
}));

vi.mock('@/lib/auth', () => ({
  useUser: () => auth,
}));

// The counts fetch is irrelevant to every assertion here and would otherwise
// hit the network on mount. A resolved-null twin keeps the effect harmless.
vi.mock('@/lib/use-viewer-fetch', () => ({
  useViewerFetch: () => ({
    viewerFetch: () => Promise.resolve({ ok: false, json: () => null }),
    isSignedIn: auth.isSignedIn,
  }),
  viewerCacheKey: (signedIn: boolean) => (signedIn ? 'member' : 'anon'),
}));

beforeEach(() => {
  nav.path = '/';
  auth.isLoaded = true;
  auth.isSignedIn = false;
});

describe('ShopModeBar — where it hides itself', () => {
  it('renders on the landing page with the public motivation entry', () => {
    render(<ShopModeBar />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buy Now' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Licence motivation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Start my application/i }).getAttribute('href'),
    ).toBe('/motivation');
  });

  // ⚠️ ONE POLICY PAGE STANDS FOR THE SET. Every entry in FINE_PRINT_PATHS is
  // checked by fine-print-routes.ts; what this asserts is that the bar
  // actually consults that predicate — the wiring, not the list.
  it('is absent on a fine-print page', () => {
    nav.path = '/terms';
    const { container } = render(<ShopModeBar />);
    expect(container.querySelector('[data-shop-mode-bar]')).toBeNull();
    expect(screen.queryByText('Buy Now')).toBeNull();
  });

  it('is absent on /privacy', () => {
    nav.path = '/privacy';
    const { container } = render(<ShopModeBar />);
    expect(container.querySelector('[data-shop-mode-bar]')).toBeNull();
  });

  it('is absent on the checkout flow', () => {
    nav.path = '/checkout/listing-123';
    const { container } = render(<ShopModeBar />);
    expect(container.querySelector('[data-shop-mode-bar]')).toBeNull();
  });

  it('is not fooled by a route that merely starts with the same word', () => {
    nav.path = '/checkouts-of-the-world';
    render(<ShopModeBar />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});

describe('ShopModeBar — the mobile scope stamp', () => {
  it('marks a shop surface as fully in scope', () => {
    nav.path = '/';
    const { container } = render(<ShopModeBar />);
    expect(
      container.querySelector('[data-shop-mode-bar]')?.getAttribute('data-shop-scope'),
    ).toBe('tabs');
  });

  it('marks a non-shop surface as mobile-only scope', () => {
    nav.path = '/bench';
    const { container } = render(<ShopModeBar />);
    const bar = container.querySelector('[data-shop-mode-bar]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('data-shop-scope')).toBe('tabs-only');
  });
});

describe('ShopModeBar — static boxes with explicit actions', () => {
  it('signed out: three boxes, three explicit links, no whole-box action', () => {
    const { container } = render(<ShopModeBar />);
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Shop Buy Now',
      'Browse Auctions',
      'Start my application',
    ]);
    // The box itself is a div; the heading is not inside a link/button.
    const heading = screen.getByRole('heading', { name: 'Buy Now' });
    expect(heading.closest('a, button')).toBeNull();
    expect(container.querySelector('nav')?.className).toContain('sm:grid-cols-3');
    // Descriptions are visible at every width — no mini tile hides them.
    expect(screen.getByText(/Fixed prices/)).toBeInTheDocument();
  });

  it('signed in: four boxes including Armory, with a direct application link', () => {
    auth.isSignedIn = true;
    const { container } = render(<ShopModeBar />);
    expect(screen.getByRole('heading', { name: 'Armory' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Continue application/i }).getAttribute('href'),
    ).toBe('/licence-centre/applications');
    expect(container.querySelector('nav')?.className).toContain('lg:grid-cols-4');
  });
});

describe('ShopModeBar — the Armory disclosure', () => {
  it('offers no Armory box when signed out', () => {
    render(<ShopModeBar />);
    expect(screen.queryByRole('button', { name: /armory/i })).toBeNull();
  });

  it('opens four tool boxes from its own button', () => {
    auth.isSignedIn = true;
    render(<ShopModeBar />);
    const armory = screen.getByRole('button', { name: /Open Armory/i });
    expect(armory.getAttribute('aria-expanded')).toBe('false');
    expect(armory.getAttribute('aria-controls')).toBe('armory-panel');
    expect(document.querySelector('#armory-panel')).toBeNull();

    fireEvent.click(armory);
    expect(armory.getAttribute('aria-expanded')).toBe('true');
    const panel = document.querySelector('#armory-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getAllByRole('link')).toHaveLength(4);
    expect(within(panel).getByRole('heading', { name: 'Motivation Writer' })).toBeInTheDocument();
  });
});

describe('ShopModeBar — the Armory panel closes with the page', () => {
  function openArmory() {
    auth.isSignedIn = true;
    const view = render(<ShopModeBar />);
    fireEvent.click(screen.getByRole('button', { name: /Open Armory/i }));
    expect(document.querySelector('#armory-panel')).not.toBeNull();
    return view;
  }

  it('closes on a pointer press anywhere outside the bar', () => {
    openArmory();
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('#armory-panel')).toBeNull();
  });

  it('closes when the page scrolls', () => {
    openArmory();
    fireEvent.scroll(document);
    expect(document.querySelector('#armory-panel')).toBeNull();
  });

  it('closes on Escape', () => {
    openArmory();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('#armory-panel')).toBeNull();
  });

  it('closes when the route changes', () => {
    const view = openArmory();
    nav.path = '/documents';
    view.rerender(<ShopModeBar />);
    expect(document.querySelector('#armory-panel')).toBeNull();
  });

  it('stays open when the press is inside the bar', () => {
    openArmory();
    fireEvent.pointerDown(
      document.querySelector('[data-shop-mode-bar]') as HTMLElement,
    );
    expect(document.querySelector('#armory-panel')).not.toBeNull();
  });
});
