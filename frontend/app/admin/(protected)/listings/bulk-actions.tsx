'use client';

// Bulk-select toolbar for the admin listings table. Wraps the table
// in a context-free component that:
//   - Renders a checkbox per row (parent passes the row IDs via the
//     `ids` prop; we maintain selection state here)
//   - Shows a sticky bottom toolbar when ≥1 selected, with bulk
//     Approve / Reject buttons (Reject opens a modal for the required
//     reason; Approve uses the same modal pattern for symmetry — the
//     backend doesn't require a reason on approve but the modal still
//     prompts for one so the audit log has context).
//
// Approval workflow only applies to PENDING_REVIEW listings; for any
// other tab the toolbar hides itself entirely (the parent decides
// whether to mount BulkActions at all by checking the status tab).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

export function useBulkSelect(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }

  function clear() {
    setSelected(new Set());
  }

  return { selected, toggle, toggleAll, clear };
}

export function BulkListingActionsBar({
  selected,
  onClear,
}: {
  selected: Set<string>;
  onClear: () => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = selected.size;

  async function execute() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/listings/bulk-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          listingIds: Array.from(selected),
          action,
          reason: reason.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      setAction(null);
      setReason('');
      onClear();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBusy(false);
    }
  }

  if (count === 0) return null;

  return (
    <>
      <div
        style={{
          position: 'sticky',
          bottom: 16,
          marginTop: 16,
          zIndex: 30,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
          padding: '12px 16px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>
          {count} listing{count === 1 ? '' : 's'} selected
        </span>
        <button
          onClick={() => setAction('APPROVE')}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={{
            background: '#22c55e18',
            color: '#22c55e',
            border: '0.5px solid #22c55e40',
            cursor: 'pointer',
          }}
        >
          Approve all
        </button>
        <button
          onClick={() => setAction('REJECT')}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={{
            background: 'var(--red)18',
            color: 'var(--red)',
            border: '0.5px solid var(--red)40',
            cursor: 'pointer',
          }}
        >
          Reject all
        </button>
        <button
          onClick={onClear}
          className="ml-auto text-xs"
          style={{
            background: 'transparent',
            color: 'var(--text-tertiary)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {action && (
        <div
          onClick={() => !busy && setAction(null)}
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
              border: `0.5px solid ${action === 'APPROVE' ? '#22c55e' : 'var(--red)'}`,
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {action === 'APPROVE' ? 'Approve' : 'Reject'} {count} listing{count === 1 ? '' : 's'}?
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              {action === 'APPROVE'
                ? 'Each listing will move to ACTIVE and be indexed in marketplace search. Sellers will be emailed individually.'
                : 'Each listing will move to CANCELLED. Sellers will be emailed individually with the reason below. Required reason ≥5 chars.'}
            </p>
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                {action === 'APPROVE' ? 'Note (optional, for audit)' : 'Reason (sent to sellers, audit log)'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                }}
                autoFocus
              />
            </div>
            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction(null)}
                disabled={busy}
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
                onClick={execute}
                disabled={busy || (action === 'REJECT' && reason.trim().length < 5)}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: busy ? 'var(--bg-inset)' : action === 'APPROVE' ? '#22c55e' : 'var(--red)',
                  color: busy ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Working…' : `${action === 'APPROVE' ? 'Approve' : 'Reject'} ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
