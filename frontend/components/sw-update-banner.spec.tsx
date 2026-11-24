// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SwUpdateBanner } from './sw-update-banner';

// The gate is driven by the service-worker registration, which jsdom does not
// implement. Stand in a waiting worker + an existing controller: that is the
// exact "this page is stale" state the modal must block on.

const waiting = {
  state: 'installed',
  postMessage: vi.fn(),
  addEventListener: vi.fn(),
};
const registration = {
  waiting,
  installing: null,
  addEventListener: vi.fn(),
};
const serviceWorker = {
  controller: {},
  getRegistration: vi.fn(async () => registration),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

beforeEach(() => {
  window.sessionStorage.clear();
  serviceWorker.controller = {};
  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorker,
    configurable: true,
  });
});

afterEach(() => {
  // Leave the fake in place: React Testing Library's automatic cleanup runs
  // after this hook and the component's effect cleanup still reads
  // navigator.serviceWorker. It is scoped to this file.
  vi.clearAllMocks();
});

describe('SwUpdateBanner', () => {
  it('blocks the page with a single Refresh action when a worker is waiting', async () => {
    render(<SwUpdateBanner />);

    const dialog = await screen.findByRole('dialog', {
      name: 'Update available',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByText(/A new version of ALL Outdoor is ready/i),
    ).toBeInTheDocument();

    // Force the click: no dismiss, no close, no secondary action.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Refresh now');

    await waitFor(() => expect(buttons[0]).toHaveFocus());
  });

  it('does not appear on a first install with no controller', async () => {
    serviceWorker.controller = null;
    render(<SwUpdateBanner />);

    // Give the registration promise room to resolve; nothing should mount.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
