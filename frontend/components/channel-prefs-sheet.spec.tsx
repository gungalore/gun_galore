// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelPrefsSheet } from './channel-prefs-sheet';

// ⚠️ .spec.tsx, WITH THE X. The Vitest include list is
// ['lib/**/*.spec.ts', 'components/**/*.spec.tsx'] — a `.spec.ts` under
// components/ is never collected, reports nothing, fails nothing, and
// passes the deploy gate by not existing (CLAUDE.md, STEP 2 of "deploy now").

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ getToken: async () => 't', isLoaded: true, isSignedIn: true }),
}));

function meResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    channelPrefsPromptedAt: null,
    notifyEmailEnabled: true,
    notifySmsEnabled: true,
    notifyWhatsappEnabled: true,
    whatsappChannelEnabled: false,
    ...overrides,
  };
}

function mockFetchSequence(handlers: Array<(url: string, init?: RequestInit) => unknown>) {
  let call = 0;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call += 1;
    const body = handler(String(url), init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ChannelPrefsSheet', () => {
  it('shows when channelPrefsPromptedAt is null', async () => {
    mockFetchSequence([() => meResponse()]);
    const onDone = vi.fn();
    render(<ChannelPrefsSheet onDone={onDone} />);

    expect(await screen.findByText('How should we reach you?')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('never shows once already stamped, and calls onDone immediately', async () => {
    mockFetchSequence([
      () => meResponse({ channelPrefsPromptedAt: '2026-09-01T00:00:00.000Z' }),
    ]);
    const onDone = vi.fn();
    render(<ChannelPrefsSheet onDone={onDone} />);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('How should we reach you?')).toBeNull();
  });

  it('dismissing still stamps (hits the dismiss route) and calls onDone', async () => {
    const calledUrls: string[] = [];
    mockFetchSequence([
      (url) => {
        calledUrls.push(url);
        return meResponse();
      },
      (url) => {
        calledUrls.push(url);
        return {};
      },
    ]);
    const onDone = vi.fn();
    render(<ChannelPrefsSheet onDone={onDone} />);
    await screen.findByText('How should we reach you?');

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calledUrls.some((u) => u.includes('/users/me/channel-prefs/dismiss'))).toBe(
      true,
    );
  });

  it('holds the email/SMS floor if the member tries to turn both off', async () => {
    mockFetchSequence([() => meResponse()]);
    const onDone = vi.fn();
    render(<ChannelPrefsSheet onDone={onDone} />);
    await screen.findByText('How should we reach you?');

    // Both Email and SMS default on; switch both off, then try to save.
    await userEvent.click(screen.getByRole('switch', { name: 'SMS notifications' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Email notifications' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(
      await screen.findByText(
        'Keep at least one of Email or SMS on so we can reach you about your orders.',
      ),
    ).toBeTruthy();
    // The floor is a client-side guard before any network call — refused
    // without hitting the submit route, so onDone must not have fired.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('renders the WhatsApp switch disabled with a "coming soon" note when the flag is off', async () => {
    mockFetchSequence([() => meResponse({ whatsappChannelEnabled: false })]);
    render(<ChannelPrefsSheet onDone={vi.fn()} />);
    await screen.findByText('How should we reach you?');

    const wa = screen.getByRole('switch', { name: 'WhatsApp notifications' });
    expect(wa.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });

  it('renders the WhatsApp switch live when the flag is on', async () => {
    mockFetchSequence([() => meResponse({ whatsappChannelEnabled: true })]);
    render(<ChannelPrefsSheet onDone={vi.fn()} />);
    await screen.findByText('How should we reach you?');

    const wa = screen.getByRole('switch', { name: 'WhatsApp notifications' });
    expect(wa.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Coming soon')).toBeNull();
  });
});
