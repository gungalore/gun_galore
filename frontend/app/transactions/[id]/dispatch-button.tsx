'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Transaction } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Dispatch is irreversible — once submitted, dispatchedAt is set,
// shippingStatus → COLLECTED, and the buyer's 7-day confirm-delivery
// clock starts (auto-release if no action). The original form accepted
// empty inputs which let a seller misclick into starting the clock
// without actually shipping. We now:
//   1. REQUIRE the tracking reference for PUDO + TCG (these are the
//      courier-tracked flows — the reference is what the buyer uses
//      to actually find their parcel)
//   2. Require a final confirmation modal that restates the
//      consequence (clock starts, buyer notified, can't undo)

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

export function DispatchButton({ tx }: { tx: Transaction }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [trackingRef, setTrackingRef] = useState('');
  const [pudoId, setPudoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Tracking reference is REQUIRED for courier-tracked shipping
  // methods. PRIVATE_ARRANGE doesn't reach this component (no
  // dispatch step). DEALER_TRANSFER might not have a tracking ref
  // until the dealer issues one, so we let it through empty for now
  // but still gate behind the confirm modal.
  const requiresTracking =
    tx.shippingMethod === 'PUDO' || tx.shippingMethod === 'TCG';
  const trackingOk = !requiresTracking || trackingRef.trim().length >= 3;
  const canSubmit = trackingOk && !loading;

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'rgba(0,160,60,0.10)', color: '#00a03c', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        Dispatch confirmed. Buyer has been notified.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }}
      >
        Confirm dispatch
      </button>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, string> = {};
      if (trackingRef) body.trackingReference = trackingRef.trim();
      if (tx.shippingMethod === 'PUDO' && pudoId) body.pudoDropoffLockerId = pudoId.trim();

      const res = await fetch(`${API_URL}/transactions/${tx.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          className="px-3 py-2 rounded-[6px] text-sm"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {tx.shippingMethod === 'PUDO' && (
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Pudo drop-off locker ID (optional)
          </label>
          <input
            type="text"
            value={pudoId}
            onChange={(e) => setPudoId(e.target.value)}
            placeholder="e.g. PUD-12345"
            style={inputStyle}
          />
        </div>
      )}

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Tracking reference {requiresTracking ? '(required)' : '(optional)'}
        </label>
        <input
          type="text"
          value={trackingRef}
          onChange={(e) => setTrackingRef(e.target.value)}
          placeholder={tx.shippingMethod === 'TCG' ? 'TCG waybill number' : 'e.g. PUD-12345'}
          style={{
            ...inputStyle,
            border: `0.5px solid ${
              requiresTracking && trackingRef.length > 0 && !trackingOk
                ? 'var(--red)'
                : 'var(--border)'
            }`,
          }}
        />
        {requiresTracking && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            The buyer uses this to track their parcel — required for
            {tx.shippingMethod === 'PUDO' ? ' Pudo' : ' courier'} dispatch.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => canSubmit && setConfirmOpen(true)}
          disabled={!canSubmit}
          className="flex-1 py-2.5 rounded-[6px] text-sm"
          style={{
            background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
            color: canSubmit ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
          title={!trackingOk ? 'Enter the tracking reference first' : undefined}
        >
          Confirm dispatch
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>

      {/* Final confirmation modal — the consequence of dispatch is the
          single thing sellers most often misunderstand. We say it
          plainly and require a deliberate click. */}
      {confirmOpen && (
        <div
          onClick={() => !loading && setConfirmOpen(false)}
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
              maxWidth: 480,
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
              Confirm dispatch — this can't be undone
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              The buyer's 7-day delivery clock starts now. They'll be
              notified that the parcel is on its way. If you haven't
              actually dropped it off / handed it to the courier yet,
              don't confirm — your dispatch SLA strike counter ticks
              if the parcel doesn't move within 48 hours of confirm.
            </p>
            <div
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              <p>
                <strong style={{ color: 'var(--text-primary)' }}>Tracking ref:</strong>{' '}
                <code style={{ fontFamily: 'monospace' }}>
                  {trackingRef.trim() || '(none)'}
                </code>
              </p>
              {tx.shippingMethod === 'PUDO' && pudoId && (
                <p style={{ marginTop: 4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Pudo locker:</strong>{' '}
                  <code style={{ fontFamily: 'monospace' }}>{pudoId.trim()}</code>
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={loading}
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
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: loading ? 'var(--bg-inset)' : 'var(--red)',
                  color: loading ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Confirming…' : 'Yes, dispatched'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
