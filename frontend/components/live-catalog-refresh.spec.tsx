// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LiveCatalogRefresh } from './live-catalog-refresh';

const refresh = vi.fn();
const auth = { isLoaded: false, isSignedIn: false, getToken: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/lib/use-live-poll', () => ({
  useLivePoll: vi.fn(),
}));

/**
 * A hard load with an expired access-token cookie renders the catalogue
 * anonymously, then the client renews the session. Without the re-run the grid
 * stays empty until the visitor navigates — the reported "listings are missing
 * on first open" bug.
 */
describe('LiveCatalogRefresh', () => {
  beforeEach(() => {
    refresh.mockClear();
    auth.isLoaded = false;
    auth.isSignedIn = false;
  });

  it('re-runs the page when the server rendered anonymously but the client is signed in', () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    render(<LiveCatalogRefresh serverSignedIn={false} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the server already resolved the member', () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    render(<LiveCatalogRefresh serverSignedIn />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing for a genuinely signed-out visitor', () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    render(<LiveCatalogRefresh serverSignedIn={false} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('waits for the auth restore before deciding', () => {
    auth.isLoaded = false;
    auth.isSignedIn = true;
    const { rerender } = render(<LiveCatalogRefresh serverSignedIn={false} />);
    expect(refresh).not.toHaveBeenCalled();

    auth.isLoaded = true;
    rerender(<LiveCatalogRefresh serverSignedIn={false} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
