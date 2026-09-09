// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MotivationSellerConsent from './motivation-seller-consent';

// ────────────────────────────────────────────────────────────────────
// THE INVITE THE SELLER GETS.
//
// ⚠️ THE ONE FAILURE THIS FILE EXISTS FOR IS "the server refuses by naming a
// box that is not on screen". It has happened TWICE in this flow now.
//
//   1. The invite once demanded the firearm's serial number. The only serial
//      in the registry was formOnly, so it was hidden unless the applicant had
//      opted into the SAPS 271 — which the default path does not. The panel
//      was unreachable and the refusal named a box nobody could find.
//   2. The server has always required the seller's EMAIL — deliberately, see
//      "BOTH, NOT EITHER" in motivation-seller-consent.service.ts — and the
//      panel had no email input, no email state, and no `email` field in the
//      API client's own body type. Every send came back "Enter a valid email
//      address for them." over a form with nowhere to enter one.
//
// So these assertions are about the SHAPE OF THE REQUEST matching what the
// server demands, and about the button never enabling into a refusal.
// ────────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  sellerConsentStatus: vi.fn(),
  inviteSellerConsent: vi.fn(),
}));

vi.mock('@/lib/motivations-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  motivationsApi: api,
}));
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: async () => 't', isLoaded: true, isSignedIn: true }),
}));

const base = {
  motivationId: 'mo-1',
  applicantName: 'Johan Pretorius',
  firearm: { make: 'CZ', model: 'Shadow 2', calibre: '9mm' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.sellerConsentStatus.mockResolvedValue({ status: 'NONE' });
  api.inviteSellerConsent.mockResolvedValue({ id: 'c1', status: 'INVITED' });
});

const send = () => screen.getByRole('button', { name: /Send them the link/i });

describe('the invite form asks for everything the server requires', () => {
  it('⚠️ HAS AN EMAIL FIELD', async () => {
    render(<MotivationSellerConsent {...base} />);
    await waitFor(() => expect(api.sellerConsentStatus).toHaveBeenCalled());
    expect(screen.getByLabelText(/Their email address/i)).toBeDefined();
  });

  it('⚠️ NEVER ENABLES INTO A REFUSAL — the gate mirrors the server', async () => {
    const user = userEvent.setup();
    render(<MotivationSellerConsent {...base} />);
    await waitFor(() => expect(api.sellerConsentStatus).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Their name/i), 'Pieter Botha');
    await user.type(screen.getByLabelText(/Their mobile number/i), '0821234567');
    // Name and number alone are what the panel used to collect. The server
    // would have refused this, so the button must not offer it.
    expect(send().hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/Their email address/i), 'pieter@example.co.za');
    expect(send().hasAttribute('disabled')).toBe(false);
  });

  it('refuses an address that is not one', async () => {
    const user = userEvent.setup();
    render(<MotivationSellerConsent {...base} />);
    await waitFor(() => expect(api.sellerConsentStatus).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Their name/i), 'Pieter Botha');
    await user.type(screen.getByLabelText(/Their mobile number/i), '0821234567');
    await user.type(screen.getByLabelText(/Their email address/i), 'pieter@example');
    expect(send().hasAttribute('disabled')).toBe(true);
  });

  it('⚠️ SENDS THE EMAIL, not just collects it', async () => {
    const user = userEvent.setup();
    render(<MotivationSellerConsent {...base} />);
    await waitFor(() => expect(api.sellerConsentStatus).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Their name/i), 'Pieter Botha');
    await user.type(screen.getByLabelText(/Their mobile number/i), '0821234567');
    await user.type(screen.getByLabelText(/Their email address/i), 'pieter@example.co.za');
    await user.click(send());

    await waitFor(() => expect(api.inviteSellerConsent).toHaveBeenCalled());
    const body = api.inviteSellerConsent.mock.calls[0][2];
    expect(body.email).toBe('pieter@example.co.za');
    expect(body.phone).toBe('0821234567');
    expect(body.name).toBe('Pieter Botha');
    // The label falls back to the firearm we already hold, so nobody
    // describes the same firearm twice.
    expect(body.firearm.label).toBe('CZ Shadow 2 9mm');
  });
});

// ────────────────────────────────────────────────────────────────────
// TELLING THE PAGE THE SELLER ANSWERED.
//
// ⚠️ THE PANEL POLLED; THE PAGE DID NOT. This panel has refreshed its own
// status every 30 seconds since it shipped, so it could say "signed" without a
// reload — but the consent, the seller's licence copies and the filled-in
// Part F land as documents ON THE APPLICATION, and every surface that shows
// them is drawn from the page's sheet. Nothing re-read it.
//
// Operator, 2026-09-09: "I have to refresh the page to import it."
// ────────────────────────────────────────────────────────────────────

describe('telling the page the seller answered', () => {
  const settled = () =>
    waitFor(() => expect(api.sellerConsentStatus).toHaveBeenCalled());

  it('fires once the status moves from invited to signed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onArrived = vi.fn();
      api.sellerConsentStatus.mockResolvedValue({ status: 'INVITED' });
      render(<MotivationSellerConsent {...base} onArrived={onArrived} />);
      await settled();
      expect(onArrived).not.toHaveBeenCalled();

      api.sellerConsentStatus.mockResolvedValue({ status: 'COMPLETED' });
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(onArrived).toHaveBeenCalledWith('COMPLETED'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('⚠️ NEVER ON THE FIRST READ, however it lands', async () => {
    // A panel mounting on an application whose seller signed last week must
    // not announce it and reload the sheet: the page has this moment loaded,
    // the paperwork is already on it, and a toast about something a week old
    // is us reporting our own first glance as news.
    const onArrived = vi.fn();
    api.sellerConsentStatus.mockResolvedValue({ status: 'COMPLETED' });
    render(<MotivationSellerConsent {...base} onArrived={onArrived} />);
    await settled();
    await new Promise((r) => setTimeout(r, 20));
    expect(onArrived).not.toHaveBeenCalled();
  });

  it('⚠️ NEVER TWICE FOR ONE ANSWER', async () => {
    // A callback on every poll would re-fetch the whole sheet every 30
    // seconds for as long as the tab is open, and reloading the sheet under a
    // member who is typing is worse than the bug.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onArrived = vi.fn();
      api.sellerConsentStatus.mockResolvedValue({ status: 'INVITED' });
      render(<MotivationSellerConsent {...base} onArrived={onArrived} />);
      await settled();
      api.sellerConsentStatus.mockResolvedValue({ status: 'COMPLETED' });
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(onArrived).toHaveBeenCalledTimes(1));
      // The poll stops once the status resolves, but a focus event still
      // refreshes — and it must not re-announce.
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onArrived).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a decline too', async () => {
    // Silence would leave the applicant waiting on somebody who has answered.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onArrived = vi.fn();
      api.sellerConsentStatus.mockResolvedValue({ status: 'INVITED' });
      render(<MotivationSellerConsent {...base} onArrived={onArrived} />);
      await settled();
      api.sellerConsentStatus.mockResolvedValue({ status: 'DECLINED' });
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(onArrived).toHaveBeenCalledWith('DECLINED'));
    } finally {
      vi.useRealTimers();
    }
  });
});
