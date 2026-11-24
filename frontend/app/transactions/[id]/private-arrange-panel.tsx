'use client';

import { useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { useRouter } from 'next/navigation';
import { BRAND_NAME } from '../../../lib/brand';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

// Private Arrangement handover (Phase 4 W2). Funds are HELD.
//
// ⚠️ THE BUYER CAN CONFIRM WITHOUT THE SELLER'S "ITEM DELIVERED" TAP. Live on
// 2026-11-24 a handover happened but the seller never opened the order page, so
// the buyer's only button was "report the handover did not happen" — pressing
// that froze the sale. The buyer's "I received it" now stands on its own (the
// backend stamps the delivered time too) and also works while a dispute is
// open, so a mis-tap can be undone without support.
//
// Both money-moving taps are behind a confirmation step: no single mis-tap can
// release a payout or freeze one.
export default function PrivateArrangePanel({
  txId,
  isBuyer,
  isSeller,
  delivered,
  received,
  disputed,
}: {
  txId: string;
  isBuyer: boolean;
  isSeller: boolean;
  delivered: string | null;
  received: string | null;
  disputed: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<'received' | 'dispute' | null>(null);

  async function post(action: 'delivered' | 'received' | 'dispute') {
    setAsk(null);
    setBusy(action);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${txId}/private-arrange/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action === 'dispute' ? { reason: 'Raised from order page' } : {}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const askCopy =
    ask === 'received'
      ? {
          title: 'Confirm you received it?',
          body: `This releases the seller's payment and is final — ${BRAND_NAME} will not refund you for a change of mind or condition concern after this.`,
          cta: 'Yes, release payment',
        }
      : {
          title: 'Report that the handover did not happen?',
          body: 'This freezes the payment while our team reviews it. Only use it if you did NOT get the item.',
          cta: 'Report handover',
        };

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
        {received
          ? 'Handover complete'
          : disputed
            ? 'Handover under review'
            : 'Confirm the handover'}
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        {received
          ? 'Receipt confirmed — payment released to the seller.'
          : disputed
            ? 'Payment is frozen while support reviews the report. If you did get the item, confirm receipt below and we will release it.'
            : 'Payment is held until the buyer confirms receipt (or 5 days after payment).'}
      </p>

      {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {isSeller && !delivered && !received && !disputed && (
          <button
            type="button"
            onClick={() => post('delivered')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {busy === 'delivered' ? 'Saving…' : 'Item delivered'}
          </button>
        )}
        {isBuyer && !received && (
          <button
            type="button"
            onClick={() => setAsk('received')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--success)' }}
          >
            {busy === 'received' ? 'Releasing…' : 'I received it'}
          </button>
        )}
        {(isBuyer || isSeller) && !received && !disputed && (
          <button
            type="button"
            onClick={() => setAsk('dispute')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md border text-[var(--text-secondary)] disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            {busy === 'dispute' ? 'Reporting…' : 'Handover did not happen'}
          </button>
        )}
      </div>

      {ask && (
        <div
          onClick={() => busy === null && setAsk(null)}
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
            role="dialog"
            aria-modal="true"
            aria-label={askCopy.title}
            style={{
              maxWidth: 420,
              width: '100%',
              padding: 22,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <p className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              {askCopy.title}
            </p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {askCopy.body}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAsk(null)}
                disabled={busy !== null}
                className="flex-1 py-2.5 rounded-[6px] text-sm"
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
                onClick={() => post(ask)}
                disabled={busy !== null}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium text-white"
                style={{
                  background: ask === 'received' ? 'var(--success)' : 'var(--red)',
                  border: 'none',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy ? 'Working…' : askCopy.cta}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
