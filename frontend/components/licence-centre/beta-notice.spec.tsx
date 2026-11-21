// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { activity } = vi.hoisted(() => ({
  activity: vi.fn(async () => ({ recorded: true as const })),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 'token' }),
}));

vi.mock('@/lib/motivations-api', () => ({
  motivationsApi: { activity },
}));

import BetaNotice from './beta-notice';

// Operator, 2026-11-21: a small popup at the start of the motivation telling
// the member it is beta and to report glitches immediately.
//
// ⚠️ ONCE PER APPLICATION, NOT ONCE PER VISIT. Opening the sheet five times in
// an evening must not mean five popups, and a second application should still
// be told.

const KEY = 'gg:motivation-beta-seen:mo1';

describe('BetaNotice', () => {
  beforeEach(() => {
    localStorage.clear();
    activity.mockClear();
  });

  it('tells the member it is beta and where to report a glitch', () => {
    render(<BetaNotice motivationId="mo1" />);
    expect(screen.getByRole('dialog', { name: /beta notice/i })).toBeTruthy();
    expect(screen.getByText(/this is a beta product/i)).toBeTruthy();
    expect(screen.getByText(/report a bug/i)).toBeTruthy();
    // The promise that makes the report useful.
    expect(screen.getByText(/your username/i)).toBeTruthy();
  });

  it('dismisses, remembers, and records that it was shown', () => {
    render(<BetaNotice motivationId="mo1" />);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('1');
    expect(activity).toHaveBeenCalledWith(
      expect.anything(),
      'mo1',
      'client_beta_notice_seen',
      expect.anything(),
    );
  });

  it('does not show again for the same application', () => {
    localStorage.setItem(KEY, '1');
    render(<BetaNotice motivationId="mo1" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows for a different application', () => {
    localStorage.setItem(KEY, '1');
    render(<BetaNotice motivationId="mo2" />);
    expect(screen.getByRole('dialog', { name: /beta notice/i })).toBeTruthy();
  });
});
