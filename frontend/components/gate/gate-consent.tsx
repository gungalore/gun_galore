'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

/**
 * The one and only control on the 18+ gate page.
 *
 * It POSTs the declaration (the backend mints the signed `ao_cat` cookie) and
 * then does a full navigation to the URL the visitor originally asked for.
 * Deliberately a full navigation, not a client-side push: the cookie must be
 * present on the next document request so the server renders the real page.
 *
 * ⚠️ NO USER-AGENT OR CRAWLER LOGIC BELONGS HERE. A crawler never executes
 * this button; that is the entire mechanism. Adding an "if bot" branch would
 * turn an age gate into cloaking.
 */
export function GateConsent({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/catalogue-declare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: true }),
      });
      // Full navigation so the follow-up request carries the new cookie.
      window.location.replace(next);
    } catch {
      setBusy(false);
      setError(
        'We could not save your confirmation just now. Please try again.',
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="gg-press w-full py-3 rounded-[6px] text-[15px] font-medium"
        style={{
          background: 'var(--action-primary-bg)',
          color: '#fff',
          border: 'none',
          cursor: busy ? 'progress' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Confirming…' : 'I am 18 or older — continue'}
      </button>
      {error && (
        <p
          role="alert"
          className="text-[13px] mt-3"
          style={{ color: 'var(--red)' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
