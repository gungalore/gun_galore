'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Transaction } from '@/lib/types';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// P5.2: when the platform has booked the courier (shipmentBookedAt set), the
// seller no longer types a tracking number — they get the waybill + Pudo PIN
// here, print the label (or write the waybill on the parcel), hand it over,
// and confirm. The legacy manual-entry form is kept as a FALLBACK for the
// rare case where booking failed (carrier outage) so dispatch never blocks.

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
  const [trackingRef, setTrackingRef] = useState(tx.trackingReference ?? '');
  const [pudoId, setPudoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printErr, setPrintErr] = useState<string | null>(null);

  // A real shipment has been booked by the platform → show the booked panel.
  const booked = Boolean(tx.shipmentBookedAt && tx.trackingReference);
  const isPudo = tx.shippingMethod === 'PUDO';

  const requiresTracking =
    tx.shippingMethod === 'PUDO' || tx.shippingMethod === 'TCG';
  const trackingOk = !requiresTracking || trackingRef.trim().length >= 3;
  const canSubmit = trackingOk && !loading;

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

  // Print the waybill — fetched through our own auth-checked proxy so the
  // carrier api_key never reaches the browser. We get the PDF as a blob and
  // open it in a new tab for printing.
  async function printWaybill() {
    setPrinting(true);
    setPrintErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${tx.id}/waybill`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setPrintErr(e instanceof Error ? e.message : 'Could not load the waybill.');
    } finally {
      setPrinting(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'rgba(0,160,60,0.10)', color: '#00a03c', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        Marked as handed over. The buyer has been notified and tracking will
        update automatically.
      </div>
    );
  }

  // ── Booked panel — everything the seller needs to ship ──────────────
  if (booked) {
    return (
      <div className="space-y-3">
        <div
          className="rounded-[8px] p-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Ready to ship
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {isPudo
              ? 'We’ve booked your Pudo shipment. Drop the parcel at any Pudo locker using the PIN below.'
              : 'We’ve booked The Courier Guy to collect from your pickup address.'}
          </p>

          <div
            className="rounded-[6px] px-3 py-2 mb-2 flex items-center justify-between gap-3"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Waybill / tracking</span>
            <code className="text-sm" style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {tx.trackingReference}
            </code>
          </div>

          {isPudo && tx.carrierDropoffPin && (
            <div
              className="rounded-[6px] px-3 py-2 mb-2 flex items-center justify-between gap-3"
              style={{ background: 'rgba(0,160,60,0.08)', border: '0.5px solid rgba(0,160,60,0.25)' }}
            >
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Locker drop-off PIN</span>
              <code className="text-base" style={{ fontFamily: 'monospace', color: '#00a03c', fontWeight: 700, letterSpacing: '0.05em' }}>
                {tx.carrierDropoffPin}
              </code>
            </div>
          )}

          <button
            onClick={printWaybill}
            disabled={printing}
            className="w-full py-2.5 rounded-[6px] text-sm mt-1"
            style={{
              background: printing ? 'var(--bg-inset)' : 'var(--red)',
              color: printing ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: printing ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {printing ? 'Loading waybill…' : 'Print waybill'}
          </button>
          {printErr && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{printErr}</p>
          )}

          <p
            className="text-xs mt-3 px-3 py-2 rounded-[6px]"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>Can&apos;t print?</strong>{' '}
            Write the waybill number{' '}
            <code style={{ fontFamily: 'monospace' }}>{tx.trackingReference}</code>{' '}
            clearly on the package so the courier can match it.
          </p>
        </div>

        {error && (
          <div
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={() => setConfirmOpen(true)}
          className="w-full py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '0.5px solid var(--border)', cursor: 'pointer', fontWeight: 500 }}
        >
          {isPudo ? 'I’ve dropped it off' : 'I’ve handed it to the courier'}
        </button>
        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Optional — tracking updates on its own once the courier scans it.
        </p>

        {confirmOpen && (
          <ConfirmModal
            loading={loading}
            trackingRef={tx.trackingReference ?? ''}
            pudoId={null}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={handleSubmit}
          />
        )}
      </div>
    );
  }

  // ── Fallback: manual tracking entry (booking unavailable) ───────────
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

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        Automatic booking isn&apos;t available for this order — enter the
        tracking reference from your own courier booking below.
      </p>
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
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
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

      {confirmOpen && (
        <ConfirmModal
          loading={loading}
          trackingRef={trackingRef.trim()}
          pudoId={tx.shippingMethod === 'PUDO' && pudoId ? pudoId.trim() : null}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSubmit}
        />
      )}
    </div>
  );
}

// Shared confirmation modal — the consequence of dispatch (clock starts,
// buyer notified, SLA strike if the parcel doesn't move) is the thing
// sellers most often misunderstand, so we state it plainly.
function ConfirmModal({
  loading,
  trackingRef,
  pudoId,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  trackingRef: string;
  pudoId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={() => !loading && onCancel()}
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
        <p className="text-base mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          Confirm hand-over — this can&apos;t be undone
        </p>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          The buyer&apos;s 7-day delivery clock starts now and they&apos;ll be
          notified the parcel is on its way. Only confirm once you&apos;ve
          actually dropped it off / handed it to the courier.
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
            <code style={{ fontFamily: 'monospace' }}>{trackingRef || '(none)'}</code>
          </p>
          {pudoId && (
            <p style={{ marginTop: 4 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Pudo locker:</strong>{' '}
              <code style={{ fontFamily: 'monospace' }}>{pudoId}</code>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
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
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: loading ? 'var(--bg-inset)' : 'var(--red)',
              color: loading ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Confirming…' : 'Yes, handed over'}
          </button>
        </div>
      </div>
    </div>
  );
}
