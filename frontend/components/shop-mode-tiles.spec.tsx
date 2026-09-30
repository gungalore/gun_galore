// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShopModeBar } from './shop-mode-tiles';

// ────────────────────────────────────────────────────────────────────
// THE BAR'S JOB IS PARTLY A NEGATIVE ONE.
//
// It was moved out of the homepage hero and mounted in the shell, which means
// it now renders on EVERY route the shell covers — including the policy pages
// and the checkout flow, neither of which had marketplace tile furniture over
// them before. So the assertions that matter most here are the ones that say
// it is ABSENT.
//
// The route it is on comes from usePathname, and the session from useUser.
// Both are mocked rather than driven, because the point is the gate and not
// the router: a spec that navigated for real would be testing Next.
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
  it('renders on the landing page', () => {
    render(<ShopModeBar />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Buy Now')).toBeInTheDocument();
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

  // A path that merely BEGINS with the same letters is not the checkout.
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

describe('ShopModeBar — the mini phone row', () => {
  // Operator, 2026-09-30: the bar occupied the whole first screen and the
  // product feed is what sells, so on a phone the three controls are now mini
  // icon buttons in ONE row — icon over label, no copy, no count. The hiding
  // and the single row are what the compact layout depends on, so both are
  // asserted here rather than left to the stylesheet.
  it('hides the tile blurb and count below sm', () => {
    render(<ShopModeBar />);
    const blurb = screen.getByText(/Fixed prices/);
    expect(blurb.className).toContain('hidden');
    expect(blurb.className).toContain('sm:block');
  });

  it('lays the phone row out as three mini buttons', () => {
    auth.isSignedIn = true;
    const { container } = render(<ShopModeBar />);
    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('grid-cols-3');

    // Armory is a mini button in the same row, not the full-width row beneath
    // it that it was — the col-span is what would put it on its own line.
    const armory = screen.getByRole('button', { name: /armory/i });
    expect(armory.className).not.toContain('col-span');
    expect(armory.className).toContain('flex-col');
    expect(armory.className).toContain('sm:flex-row');
  });
});

describe('ShopModeBar — the Armory disclosure', () => {
  it('offers no Armory tile when signed out', () => {
    render(<ShopModeBar />);
    expect(screen.queryByRole('button', { name: /armory/i })).toBeNull();
  });

  it('offers the Armory tile and reveals its four tools when signed in', () => {
    auth.isSignedIn = true;
    render(<ShopModeBar />);
    const armory = screen.getByRole('button', { name: /armory/i });
    expect(armory).toBeInTheDocument();
    // Collapsed to begin with — the panel is the point of the control.
    expect(document.querySelectorAll('.gg-armory-sub')).toHaveLength(0);

    fireEvent.click(armory);
    // Every sub-tile is a link, and the cascade class is what staggers them.
    expect(document.querySelectorAll('.gg-armory-sub')).toHaveLength(4);
    // ⚠️ THE STAGGER IS THE DELAY, AND IT IS PER-INDEX. An earlier draft gave
    // every tile the class but no delay, which renders all four at once and
    // looks like a fade — the operator asked for them to fall one after
    // another, so the ordering is asserted, not just the presence.
    const delays = Array.from(
      document.querySelectorAll('.gg-armory-sub'),
    ).map((el) => (el as HTMLElement).style.animationDelay);
    expect(delays).toEqual(['0ms', '200ms', '400ms', '600ms']);
  });
});
