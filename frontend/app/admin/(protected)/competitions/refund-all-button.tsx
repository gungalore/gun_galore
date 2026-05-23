'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getAdminToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('gg_admin_sess='))
      ?.split('=')[1] ?? ''
  );
}

// Admin-only "Refund all buyers" button. Confirms by requiring the
// operator to type the raffle's RAxxxxxx reference number — a destructive
// action that hits Peach for every confirmed ticket, so we want a typed
// confirmation rather than a one-click "Are you sure?" dialog. Backend
// double-checks the reference before issuing any refunds.
export function RefundAllButton({
  raffleId,
  referenceNumber,
  title,
}: {
  raffleId: string;
  referenceNumber: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    ticketsProcessed: number;
    ticketsRefunded: number;
    ticketsFailed: { ticketId: string; message?: string }[];
  } | null>(null);

  const expected = (referenceNumber || '').trim().toUpperCase();
  const typedOk = typed.trim().toUpperCase() === expected && expected.length > 0;

  async function handleConfirm() {
    if (!typedOk) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/raffles/${raffleId}/refund-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ typedReference: typed.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund-all failed');
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setTyped('');
    setError(null);
    if (result) router.refresh(); // refresh the list to pick up status change
    setResult(null);
  }

  if (!referenceNumber) {
    // Can't confirm against a missing reference — show a disabled hint.
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--text-tertiary)' }}
        title="No reference number — cannot refund-all"
      >
        Refund all (n/a)
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs hover:underline"
        style={{ color: 'var(--red)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        Refund all
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={handleClose}
        >
          <div
            className="rounded-[8px] p-6 max-w-md w-full"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {result ? (
              <>
                <h3
                  className="text-lg mb-3"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  Refund-all complete
                </h3>
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                  {result.ticketsRefunded} of {result.ticketsProcessed} ticket
                  {result.ticketsProcessed === 1 ? '' : 's'} refunded successfully.
                </p>
                {result.ticketsFailed.length > 0 && (
                  <div
                    className="mt-3 p-3 rounded-[6px] text-xs"
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: '0.5px solid rgba(239,68,68,0.3)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <p className="mb-2" style={{ color: '#ef4444', fontWeight: 500 }}>
                      {result.ticketsFailed.length} ticket
                      {result.ticketsFailed.length === 1 ? '' : 's'} failed:
                    </p>
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                      {result.ticketsFailed.map((t) => (
                        <li key={t.ticketId} style={{ fontFamily: 'monospace' }}>
                          {t.ticketId.slice(0, 8)} — {t.message ?? 'unknown error'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full mt-4 py-2.5 rounded-[6px] text-sm font-medium"
                  style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <h3
                  className="text-lg mb-2"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  Refund all buyers
                </h3>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                  This cancels <span style={{ color: 'var(--text-primary)' }}>{title}</span> and
                  issues Peach refunds for every confirmed ticket. The raffle status moves to
                  CANCELLED_BY_ADMIN.
                </p>

                <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  Type the raffle reference number to confirm:
                </p>
                <p
                  className="text-sm mb-3"
                  style={{
                    fontFamily: 'monospace',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  {expected}
                </p>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="RAxxxxxx"
                  className="w-full px-3 py-2 rounded-[6px] text-sm mb-3"
                  style={{
                    background: 'var(--bg-inset)',
                    border: typedOk
                      ? '0.5px solid #22c55e'
                      : '0.5px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                  }}
                  autoFocus
                />

                {error && (
                  <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                    {error}
                  </p>
                )}

                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 py-2.5 rounded-[6px] text-sm"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      cursor: 'pointer',
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!typedOk || busy}
                    className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                    style={{
                      background: !typedOk || busy ? 'var(--bg-inset)' : 'var(--red)',
                      color: !typedOk || busy ? 'var(--text-tertiary)' : '#fff',
                      border: !typedOk || busy ? '0.5px solid var(--border)' : 'none',
                      cursor: !typedOk || busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busy ? 'Refunding…' : 'Refund all buyers'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
