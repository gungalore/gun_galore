'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function ReceivedOfferActions({
  offerId,
  offerAmount,
}: {
  offerId: string;
  // Pass through so the confirm modal can restate the price the
  // seller is committing to (accept) or rejecting. Page-side default
  // keeps backwards-compat for any caller that doesn't pass it.
  offerAmount?: number;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [showCounter, setShowCounter] = useState(false);
  const [counterAmount, setCounterAmount] = useState('');
  const [sellerNote, setSellerNote] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Accept/reject both irrevocable: accept locks in the price + a
  // 24h buyer payment window; reject closes the offer (buyer can't
  // re-offer on a Take-a-Shot). Both go through a confirm modal now
  // instead of fire-on-click.
  const [confirm, setConfirm] = useState<null | 'accept' | 'reject'>(null);

  function formatRand(cents: number | undefined) {
    if (cents === undefined) return '';
    return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
  }

  async function call(endpoint: string, label: string, body?: object) {
    setLoading(label);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers/${offerId}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  async function submitCounter() {
    const cents = Math.round(parseFloat(counterAmount) * 100);
    if (!cents || cents < 100) {
      setError('Minimum counter is R1.00');
      return;
    }
    await call('counter', 'counter', {
      counterAmount: cents,
      sellerNote: sellerNote || undefined,
    });
  }

  if (showCounter) {
    return (
      <div className="space-y-2">
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            R
          </span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={counterAmount}
            onChange={(e) => setCounterAmount(e.target.value)}
            placeholder="Counter amount"
            className="w-full pl-7 pr-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <textarea
          value={sellerNote}
          onChange={(e) => setSellerNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Note to buyer (optional)"
          className="w-full px-3 py-2 rounded-[6px] text-sm resize-none"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          No phone numbers, emails, or social handles — once the buyer pays, the platform handles handoff.
        </p>
        <div className="flex gap-2">
          <button
            onClick={submitCounter}
            disabled={!!loading}
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{
              background: loading ? 'var(--bg-inset)' : '#3b82f6',
              color: loading ? 'var(--text-tertiary)' : '#fff',
            }}
          >
            {loading === 'counter' ? 'Sending…' : 'Send counter'}
          </button>
          <button
            onClick={() => setShowCounter(false)}
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setConfirm('accept')}
          disabled={!!loading}
          className="flex-1 py-2 rounded-[6px] text-sm font-medium"
          style={{
            background: loading === 'accept' ? 'var(--bg-inset)' : 'var(--red)',
            color: loading === 'accept' ? 'var(--text-tertiary)' : '#fff',
          }}
        >
          {loading === 'accept' ? 'Accepting…' : 'Accept'}
        </button>
        <button
          onClick={() => setShowCounter(true)}
          disabled={!!loading}
          className="flex-1 py-2 rounded-[6px] text-sm"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid #3b82f6',
            color: '#3b82f6',
          }}
        >
          Counter
        </button>
        <button
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
        {error && <p className="w-full text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
      </div>

      {confirm && (
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
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 460,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: `0.5px solid ${confirm === 'accept' ? 'var(--red)' : 'var(--border)'}`,
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {confirm === 'accept'
                ? `Accept this offer at ${formatRand(offerAmount)}?`
                : 'Decline this offer?'}
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              {confirm === 'accept' ? (
                <>
                  Accepting locks in the price{offerAmount ? ` of ${formatRand(offerAmount)}` : ''}.
                  The buyer has 24 hours to complete checkout — if they
                  don't, the offer expires and the listing stays active.
                </>
              ) : (
                <>
                  Declining closes the offer permanently. The buyer
                  can't re-offer on this listing — Take-a-Shot allows
                  one offer per buyer per listing. Consider countering
                  if there's room to negotiate.
                </>
              )}
            </p>
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
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await call(confirm, confirm);
                  setConfirm(null);
                }}
                disabled={!!loading}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: loading
                    ? 'var(--bg-inset)'
                    : confirm === 'accept'
                      ? 'var(--red)'
                      : '#6b7280',
                  color: loading ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading
                  ? 'Working…'
                  : confirm === 'accept'
                    ? 'Yes, accept'
                    : 'Yes, decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
