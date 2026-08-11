'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

// Form is rendered only when the current admin is SUPERADMIN (the
// parent server component decides). It still 403s server-side as a
// belt-and-braces check.
//
// Email → Clerk-linked User lookup: the backend refuses unknown emails,
// so the admin enters the user's existing All Outdoor email and gets an
// error if they haven't signed up yet.
export default function CreateAdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'SUPERADMIN' | 'MONITORING_ADMIN'>(
    'MONITORING_ADMIN',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      setSuccess(`Admin created for ${email}.`);
      setEmail('');
      setRole('MONITORING_ADMIN');
      // Re-fetch the server-rendered list so the new row shows up.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create admin');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[8px] p-5 mb-6"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        Add an admin
      </p>
      <form
        onSubmit={onSubmit}
        className="grid items-end gap-3"
        style={{ gridTemplateColumns: '1fr 200px auto' }}
      >
        <div>
          <label
            className="block text-xs mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Existing All Outdoor email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="someone@example.com"
            disabled={busy}
            className="w-full px-3 py-2 rounded-[6px] text-sm outline-none"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <div>
          <label
            className="block text-xs mb-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Role
          </label>
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as 'SUPERADMIN' | 'MONITORING_ADMIN')
            }
            disabled={busy}
            className="w-full px-3 py-2 rounded-[6px] text-sm outline-none"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="MONITORING_ADMIN">Monitoring admin</option>
            <option value="SUPERADMIN">Full admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="px-5 py-2 rounded-[6px] text-sm"
          style={{
            background: busy || !email.trim() ? 'var(--bg-inset)' : 'var(--red)',
            color:
              busy || !email.trim() ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: busy || !email.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            height: 38,
          }}
        >
          {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>

      {error && (
        <p className="text-xs mt-3" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs mt-3" style={{ color: '#22c55e' }}>
          {success}
        </p>
      )}
    </div>
  );
}
