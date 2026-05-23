'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';
import type { AdminRecord } from './page';

// Maps the on-disk enum value to the user-facing label.
function roleLabel(role: AdminRecord['role']): string {
  if (role === 'SUPERADMIN') return 'Full admin';
  if (role === 'MONITORING_ADMIN') return 'Monitoring admin';
  return 'Admin'; // legacy ADMIN tier — read-only
}

function roleColor(role: AdminRecord['role']): string {
  if (role === 'SUPERADMIN') return 'var(--red)';
  if (role === 'MONITORING_ADMIN') return '#0ea5e9';
  return 'var(--text-tertiary)';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

interface Props {
  admin: AdminRecord;
  canManage: boolean;
  isSelf: boolean;
}

export default function AdminRow({ admin, canManage, isSelf }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'role' | 'deactivate' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(role: 'SUPERADMIN' | 'MONITORING_ADMIN') {
    if (role === admin.role) return;
    setError(null);
    setBusy('role');
    try {
      const res = await adminFetch(`/admin/admins/${admin.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change role');
    } finally {
      setBusy(null);
    }
  }

  async function deactivate() {
    if (!confirm(`Deactivate admin ${admin.email}?`)) return;
    setError(null);
    setBusy('deactivate');
    try {
      const res = await adminFetch(
        `/admin/admins/${admin.id}/deactivate`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate');
    } finally {
      setBusy(null);
    }
  }

  const name =
    [admin.firstName, admin.lastName].filter(Boolean).join(' ') || '—';

  return (
    <div
      className="grid items-center gap-3 px-5 py-3 text-sm"
      style={{
        gridTemplateColumns: '1fr 1fr 160px 140px 100px',
        color: 'var(--text-primary)',
        borderBottom: '0.5px solid var(--border-divider, var(--border))',
      }}
    >
      <span>
        {name}
        {isSelf && (
          <span
            className="text-xs ml-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            (you)
          </span>
        )}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{admin.email}</span>

      <span>
        {canManage && !isSelf ? (
          <select
            value={
              admin.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'MONITORING_ADMIN'
            }
            onChange={(e) =>
              changeRole(e.target.value as 'SUPERADMIN' | 'MONITORING_ADMIN')
            }
            disabled={busy !== null}
            className="text-xs px-2 py-1 rounded-[4px]"
            style={{
              background: 'var(--bg-inset)',
              border: `0.5px solid ${roleColor(admin.role)}`,
              color: roleColor(admin.role),
              fontWeight: 500,
            }}
          >
            <option value="MONITORING_ADMIN">Monitoring admin</option>
            <option value="SUPERADMIN">Full admin</option>
          </select>
        ) : (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              background: `${roleColor(admin.role)}1f`,
              border: `0.5px solid ${roleColor(admin.role)}`,
              color: roleColor(admin.role),
              fontWeight: 500,
            }}
          >
            {roleLabel(admin.role)}
          </span>
        )}
      </span>

      <span
        className="text-xs"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {fmtDate(admin.lastLoginAt)}
      </span>

      <span style={{ textAlign: 'right' }}>
        {admin.isActive ? (
          canManage && !isSelf ? (
            <button
              type="button"
              onClick={deactivate}
              disabled={busy !== null}
              className="text-xs"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--red)',
                cursor: busy ? 'not-allowed' : 'pointer',
                padding: 0,
              }}
            >
              {busy === 'deactivate' ? '…' : 'Deactivate'}
            </button>
          ) : (
            <span
              className="text-xs"
              style={{ color: '#22c55e' }}
            >
              Active
            </span>
          )
        ) : (
          <span
            className="text-xs"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Inactive
          </span>
        )}
        {error && (
          <span
            className="block text-xs mt-1"
            style={{ color: 'var(--red)' }}
          >
            {error}
          </span>
        )}
      </span>
    </div>
  );
}
