// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ListingInterest } from './listing-interest';

// The button is the whole contract: a seller must NOT see numbers on the card,
// and the panel must only exist after a deliberate click. These tests pin that
// plus the two failure modes that matter — a bad response must not render
// fabricated zeros, and dismissal must work from the keyboard.

const getToken = vi.fn(async () => 'test-token');

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ getToken }),
}));

function payload(overrides: Record<string, unknown> = {}) {
  return {
    listingId: 'listing-1',
    listingType: 'BUY_NOW',
    status: 'ACTIVE',
    liveSinceDays: 19,
    views: { total: 231, last7d: 42 },
    saves: { total: 5, last7d: 2 },
    offers: { total: 2, last7d: 1, open: 1 },
    bids: { total: 0, last7d: 0 },
    watchers: { total: 0, last7d: 0 },
    questions: { total: 3, last7d: 0 },
    ...overrides,
  };
}

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  getToken.mockClear();
  // jsdom has no matchMedia; the component uses it only to choose the form.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ListingInterest', () => {
  it('renders no numbers until the seller clicks', () => {
    mockFetch(payload());
    render(<ListingInterest listingId="listing-1" />);

    expect(screen.getByRole('button', { name: /interest/i })).toBeTruthy();
    expect(screen.queryByText('231')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a dialog on click and shows the totals with a 7-day column', async () => {
    const fetchMock = mockFetch(payload());
    render(<ListingInterest listingId="listing-1" />);

    fireEvent.click(screen.getByRole('button', { name: /interest/i }));

    const dialog = await screen.findByRole('dialog', { name: /listing interest/i });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(screen.getByText('231')).toBeTruthy());

    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    expect(screen.getByText(/Live for 19 days/)).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/listings/listing-1/interest');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
  });

  it('shows auction rows only for an auction', async () => {
    mockFetch(
      payload({
        listingType: 'AUCTION',
        bids: { total: 12, last7d: 4 },
        watchers: { total: 4, last7d: 1 },
      }),
    );
    render(<ListingInterest listingId="listing-1" />);
    fireEvent.click(screen.getByRole('button', { name: /interest/i }));

    await screen.findByText('Bids');
    expect(screen.getByText('Watching')).toBeTruthy();
  });

  it('never renders zeros for a failed fetch', async () => {
    mockFetch({}, false);
    render(<ListingInterest listingId="listing-1" />);
    fireEvent.click(screen.getByRole('button', { name: /interest/i }));

    await screen.findByText(/couldn't load this listing's interest/i);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    mockFetch(payload());
    render(<ListingInterest listingId="listing-1" />);
    const trigger = screen.getByRole('button', { name: /interest/i });

    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
