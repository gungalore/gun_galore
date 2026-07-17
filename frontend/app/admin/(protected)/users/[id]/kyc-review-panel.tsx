'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-auth';

// Approve/Reject panel for an UNDER_REVIEW Claude-KYC verification.
// Rendered inside the user dossier next to the findings table. A short
// reason is mandatory (audit trail); the backend guards the transition
// so two admins can't double-decide.
export function KycReviewPanel({
  userId,
  onDecided,
}: {
  userId: string;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState('');

  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (reason.trim().length < 5) {
      setError('Enter a short reason (min 5 characters) first.');
      return;
    }
    if (
      decision === 'REJECT' &&
      !window.confirm(
        'Reject this verification? The seller is notified and their payout stays blocked.',
      )
    ) {
      return;
    }
    setBusy(decision);
    setError('');
    try {
      const res = await adminFetch(`/admin/users/${userId}/kyc-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || `Failed (${res.status})`);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-[8px] p-4 mt-3"
      style={{
        background: 'rgba(245,158,11,0.06)',
        border: '0.5px solid rgba(245,158,11,0.35)',
      }}
    >
      <p
        className="text-xs uppercase mb-2"
        style={{ color: '#f59e0b', letterSpacing: '0.08em', fontWeight: 600 }}
      >
        Verification awaiting your decision
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Open the ID document + selfie above, check the findings + cross-check
        flags, then decide. The seller gets the standard SMS/email either way;
        your reason stays internal.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (internal, min 5 chars) — e.g. faces match, doc legible; OCR just misread the ID number"
        rows={2}
        className="w-full text-sm rounded-[6px] p-2 mb-2"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          resize: 'vertical',
        }}
      />
      {error && (
        <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => decide('APPROVE')}
          disabled={busy !== null}
          className="text-sm rounded-[6px] px-4 py-2"
          style={{
            background: busy ? 'var(--bg-inset)' : '#16a34a',
            color: busy ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {busy === 'APPROVE' ? 'Approving…' : 'Approve — verify seller'}
        </button>
        <button
          onClick={() => decide('REJECT')}
          disabled={busy !== null}
          className="text-sm rounded-[6px] px-4 py-2"
          style={{
            background: 'transparent',
            color: busy ? 'var(--text-tertiary)' : 'var(--red)',
            border: '0.5px solid var(--red)',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {busy === 'REJECT' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
