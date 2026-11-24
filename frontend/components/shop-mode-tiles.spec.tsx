// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ShopModeBar } from './shop-mode-tiles';

// ────────────────────────────────────────────────────────────────────
// The bar is now three label-only quick actions, not four described boxes.
// The assertions that matter:
//   * it still hides on fine-print/checkout routes;
//   * signed out, Armory is a link to the auth wall (no member panel);
//   * signed in, Armory is a disclosure with three described child buttons;
//   * there is exactly one Motivation Creator entry.
// ────────────────────────────────────────────────────────────────────

const nav = vi.hoisted(() => ({ path: '/' }));
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
}));

vi.mock('@/lib/auth', () => ({
  useUser: () => auth,
}));

beforeEach(() => {
  nav.path = '/';
  auth.isLoaded = true;
  auth.isSignedIn = false;
});

describe('ShopModeBar — where it hides itself', () => {
  it('renders the three quick actions on the landing page', () => {
    render(<ShopModeBar />);
    const bar = screen.getByRole('navigation', { name: 'Quick actions' });

    expect(within(bar).getByRole('link', { name: 'Sell your gear' }).getAttribute('href')).toBe(
      '/listings/new',
    );
    expect(
      within(bar).getByRole('link', { name: 'Motivation Creator' }).getAttribute('href'),
    ).toBe('/motivation');
    expect(within(bar).getByRole('link', { name: 'Armory' }).getAttribute('href')).toBe(
      '/account',
    );
  });

  it('carries no descriptions on the top-level buttons', () => {
    render(<ShopModeBar />);
    expect(screen.queryByText(/Fixed prices/i)).toBeNull();
    expect(screen.queryByText(/Live bidding/i)).toBeNull();
    expect(screen.queryByText(/Store all Motivation Documents/i)).toBeNull();
  });

  it('is absent on a fine-print page', () => {
    nav.path = '/terms';
    const { container } = render(<ShopModeBar />);
    expect(container.querySelector('[data-shop-mode-bar]')).toBeNull();
    expect(screen.queryByText('Sell your gear')).toBeNull();
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
    expect(screen.getByRole('navigation', { name: 'Quick actions' })).toBeInTheDocument();
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

describe('ShopModeBar — the member Armory disclosure', () => {
  it('signed out: no disclosure, no member child labels', () => {
    render(<ShopModeBar />);
    expect(screen.queryByRole('button', { name: /armory/i })).toBeNull();
    expect(screen.queryByText(/Paper Work Vault/i)).toBeNull();
    expect(screen.queryByText(/Reloading Tool/i)).toBeNull();
  });

  it('signed in: Motivation Creator goes straight to the application', () => {
    auth.isSignedIn = true;
    render(<ShopModeBar />);
    expect(
      screen.getByRole('link', { name: 'Motivation Creator' }).getAttribute('href'),
    ).toBe('/licence-centre/applications');
  });

  it('opens three child buttons with their descriptions inside the button', () => {
    auth.isSignedIn = true;
    render(<ShopModeBar />);
    const armory = screen.getByRole('button', { name: /Armory/i });
    expect(armory.getAttribute('aria-expanded')).toBe('false');
    expect(armory.getAttribute('aria-controls')).toBe('armory-panel');
    expect(document.querySelector('#armory-panel')).toBeNull();

    fireEvent.click(armory);
    expect(armory.getAttribute('aria-expanded')).toBe('true');
    const panel = document.querySelector('#armory-panel') as HTMLElement;
    expect(panel).not.toBeNull();

    const children = within(panel).getAllByRole('link');
    expect(children).toHaveLength(3);
    expect(
      within(panel).getByRole('link', { name: /Paper Work Vault/i }),
    ).toHaveTextContent('Store all Motivation Documents');
    expect(
      within(panel).getByRole('link', { name: /Reloading Tool/i }),
    ).toHaveTextContent('Work up a load');
    expect(
      within(panel).getByRole('link', { name: /Application Tracker/i }),
    ).toHaveTextContent('Track your Application');

    // The dedicated Motivation Creator button is the only motivation entry.
    expect(within(panel).queryByText(/Motivation Writer/i)).toBeNull();
  });
});

describe('ShopModeBar — the Armory panel closes with the page', () => {
  function openArmory() {
    auth.isSignedIn = true;
    const view = render(<ShopModeBar />);
    fireEvent.click(screen.getByRole('button', { name: /Armory/i }));
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
