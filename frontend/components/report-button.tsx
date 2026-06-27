'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const REASONS: { value: string; label: string }[] = [
  { value: 'prohibited', label: 'Prohibited / illegal item' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'counterfeit', label: 'Counterfeit / misrepresented' },
  { value: 'suspicious', label: 'Suspicious behaviour' },
  { value: 'other', label: 'Something else' },
];

// Reusable "Report" affordance for a listing or a seller. Renders a subtle
// text button that opens a modal (reason + optional note) and POSTs to the
// reports endpoint. Signed-in only — the API is Clerk-guarded.
export function ReportButton({
  kind,
  targetId,
  label,
}: {
  kind: 'listing' | 'seller';
  targetId: string;
  label?: string;
}) {
  const { getToken, isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('prohibited');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const path =
        kind === 'listing'
          ? `/reports/listing/${targetId}`
          : `/reports/seller/${targetId}`;
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        {label ?? `⚑ Report ${kind}`}
      </button>

      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
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
              maxWidth: 420,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            {done ? (
              <>
                <p className="text-base mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  Thanks — report received
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Our team will review this {kind}. We don&apos;t share who reported it.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full py-2.5 rounded-[6px] text-sm"
                  style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-base mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  Report this {kind}
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  Tell us what&apos;s wrong. Reports are confidential and help keep Gun Galore safe.
                </p>

                {!isSignedIn ? (
                  <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Please sign in to report.
                  </p>
                ) : (
                  <>
                    <label className="text-xs block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Reason
                    </label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full mb-3"
                      style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }}
                    >
                      {REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 500))}
                      placeholder="Add any detail (optional)"
                      rows={3}
                      className="w-full mb-3"
                      style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', resize: 'vertical' }}
                    />
                  </>
                )}

                {error && (
                  <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                    {error}
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="flex-1 py-2.5 rounded-[6px] text-sm"
                    style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  {isSignedIn && (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={busy}
                      className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                      style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      {busy ? 'Submitting…' : 'Submit report'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
