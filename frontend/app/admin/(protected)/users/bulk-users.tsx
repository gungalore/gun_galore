'use client';

// Client-side bulk-ban shell for the admin users table. Adds a
// checkbox column and a sticky toolbar with a single "Ban selected"
// action. Reason required (≥5 chars) — recorded as a USER_BAN audit
// row against each selected user. Capped at 50 per call (backend
// enforces).
//
// Doesn't replace the existing per-row UserActions component — that
// stays in the rightmost cell for tier / KYC / single-ban changes.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';
import UserActions from './user-actions';

interface User {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  sellerTier: string;
  kycStatus: string;
  isBanned: boolean;
  totalSales: number;
  trustScore: number;
  averageRating: number | null;
  createdAt: string;
}

export default function BulkUsersTable({ users }: { users: User[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allChecked, setAllChecked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only users that aren't already banned can be selected — selecting
  // an already-banned user and re-banning is a no-op the backend
  // skips, but visually filtering them keeps the count accurate.
  const eligibleIds = users.filter((u) => !u.isBanned).map((u) => u.id);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
      setAllChecked(false);
    } else {
      setSelected(new Set(eligibleIds));
      setAllChecked(true);
    }
  }

  async function executeBan() {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/users/bulk-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: Array.from(selected),
          reason: reason.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      setConfirmOpen(false);
      setSelected(new Set());
      setAllChecked(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk ban failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-[8px] overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-inset)' }}>
              <th
                className="px-3 py-2.5"
                style={{ width: 36, borderBottom: '0.5px solid var(--border)' }}
              >
                <input
                  type="checkbox"
                  checked={allChecked && eligibleIds.length > 0}
                  onChange={toggleAll}
                  aria-label="Select all eligible users on this page"
                  disabled={eligibleIds.length === 0}
                  style={{ accentColor: 'var(--red)' }}
                />
              </th>
              {['User', 'Tier', 'KYC', 'Sales', 'Score', 'Rating', 'Joined', ''].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-2.5 text-xs font-medium"
                  style={{ color: 'var(--text-tertiary)', borderBottom: '0.5px solid var(--border)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelected = selected.has(u.id);
              return (
                <tr
                  key={u.id}
                  style={{
                    borderBottom: '0.5px solid var(--border-divider)',
                    background: isSelected
                      ? 'rgba(200,16,46,0.05)'
                      : u.isBanned
                        ? 'var(--red)08'
                        : undefined,
                  }}
                >
                  <td className="px-3 py-3" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={u.isBanned}
                      onChange={() => toggle(u.id)}
                      aria-label={`Select @${u.username ?? u.email} for bulk ban`}
                      style={{ accentColor: 'var(--red)' }}
                    />
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                    <Link
                      href={`/admin/users/${u.id}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      <div className="font-medium">
                        @{u.username ?? '(no username)'}
                        {u.isBanned && (
                          <span
                            className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: 'var(--red)20', color: 'var(--red)' }}
                          >
                            banned
                          </span>
                        )}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.email}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {u.sellerTier}
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{
                      color: u.kycStatus === 'VERIFIED' ? '#22c55e' : 'var(--text-tertiary)',
                    }}
                  >
                    {u.kycStatus}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {u.totalSales}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {u.trustScore}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {u.averageRating ? `${u.averageRating.toFixed(1)} ★` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(u.createdAt).toLocaleDateString('en-ZA')}
                  </td>
                  <td className="px-4 py-3">
                    <UserActions
                      userId={u.id}
                      username={u.username}
                      isBanned={u.isBanned}
                      sellerTier={u.sellerTier}
                      kycStatus={u.kycStatus}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 16,
            marginTop: 16,
            zIndex: 30,
            background: 'var(--bg-card)',
            border: '0.5px solid var(--red)',
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
            {selected.size} user{selected.size === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={() => setConfirmOpen(true)}
            className="px-3 py-1.5 rounded text-xs font-medium"
            style={{
              background: 'var(--red)18',
              color: 'var(--red)',
              border: '0.5px solid var(--red)40',
              cursor: 'pointer',
            }}
          >
            Ban {selected.size} user{selected.size === 1 ? '' : 's'}
          </button>
          <button
            onClick={() => {
              setSelected(new Set());
              setAllChecked(false);
            }}
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
      )}

      {confirmOpen && (
        <div
          onClick={() => !busy && setConfirmOpen(false)}
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
              maxWidth: 520,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: '0.5px solid var(--red)',
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Ban {selected.size} user{selected.size === 1 ? '' : 's'}?
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              Each user loses platform access immediately — can't bid,
              buy, sell, or contact other users. The reason below is
              recorded against each user&apos;s audit log. Reversible by
              an admin one-by-one (no bulk unban).
            </p>
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                Reason (≥5 chars, recorded against every selected user)
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
                onClick={() => setConfirmOpen(false)}
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
                onClick={executeBan}
                disabled={busy || reason.trim().length < 5}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: busy ? 'var(--bg-inset)' : 'var(--red)',
                  color: busy ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Banning…' : `Ban ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
