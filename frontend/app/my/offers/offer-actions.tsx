'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Both buyer-side closes are irreversible: declining a counter flips the offer
// to REJECTED, withdrawing flips it to WITHDRAWN, and neither can be undone.
// The buyer MAY re-offer afterwards (offers.service.ts re-uses the same row on
// REJECTED/WITHDRAWN/EXPIRED) but each fresh round increments attemptCount
// against the 5-offer cap for that listing — so the honest warning is "you can
// re-offer, but attempts are limited", not "you can never offer again".
// The seller side of this exact flow already confirms before closing an offer;
// one mis-tap on mobile shouldn't quietly kill a live negotiation.
const CONFIRM_COPY = {
  reject: {
    title: 'Decline this counter?',
    body: "Declining ends this negotiation — the seller's counter closes for good and they're told you passed. You can make a fresh offer on this listing afterwards, but each listing allows only 5 offers in total.",
    cta: 'Yes, decline',
    keep: 'Keep negotiating',
  },
  withdraw: {
    title: 'Withdraw your offer?',
    body: 'The seller is told you pulled out and this offer closes immediately. You can offer on this listing again later, but each listing allows only 5 offers in total.',
    cta: 'Yes, withdraw',
    keep: 'Keep my offer',
  },
} as const;

export default function OfferActions({
  offerId,
  action,
}: {
  offerId: string;
  action: 'counter' | 'withdraw';
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Which destructive action is awaiting confirmation. Accepting a counter
  // stays a single tap — it moves the deal forward and lands on checkout,
  // where the buyer can still walk away.
  const [confirm, setConfirm] = useState<null | 'reject' | 'withdraw'>(null);

  // Returns whether the call succeeded so the confirm sheet can stay open on
  // failure (a race — the seller accepted first, the offer already expired —
  // must surface inside the sheet, not behind it).
  async function call(endpoint: string, label: string): Promise<boolean> {
    setLoading(label);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers/${offerId}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? `Error ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      return false;
    } finally {
      setLoading(null);
    }
  }

  const copy = confirm ? CONFIRM_COPY[confirm] : null;

  return (
    <div>
      {action === 'counter' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => call('accept-counter', 'accept')}
            disabled={!!loading}
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{
              background: loading === 'accept' ? 'var(--bg-inset)' : 'var(--red)',
              color: loading === 'accept' ? 'var(--text-tertiary)' : '#fff',
            }}
          >
            {loading === 'accept' ? 'Accepting…' : 'Accept counter'}
          </button>
          <button
            type="button"
            onClick={() => setConfirm('reject')}
            disabled={!!loading}
            className="flex-1 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: loading === 'reject' ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            }}
          >
            {loading === 'reject' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      )}

      {action === 'withdraw' && (
        <button
          type="button"
          onClick={() => setConfirm('withdraw')}
          disabled={!!loading}
          className="text-xs"
          style={{ color: loading ? 'var(--text-tertiary)' : 'var(--text-tertiary)' }}
        >
          {loading ? 'Withdrawing…' : 'Withdraw offer'}
        </button>
      )}

      {error && <p className="text-xs mt-1.5" style={{ color: 'var(--red)' }}>{error}</p>}

      {/* Confirm sheet — same pattern (and z-index) as the seller-side
          received-offer-actions modal. zIndex must stay ≥ 60: the PWA
          bottom tab bar sits at 55 and would otherwise occlude it. */}
      {confirm && copy && (
        <div
          onClick={() => !loading && setConfirm(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={copy.title}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 460,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {copy.title}
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              {copy.body}
            </p>
            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={!!loading}
                className="flex-1 py-2 rounded text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                {copy.keep}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const isReject = confirm === 'reject';
                  const ok = await call(
                    isReject ? 'reject-counter' : 'withdraw',
                    confirm,
                  );
                  if (ok) setConfirm(null);
                }}
                disabled={!!loading}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: loading ? 'var(--bg-inset)' : '#6b7280',
                  color: loading ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Working…' : copy.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
