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

// Single-click unban — no modal. The audit log captures the operator's
// admin id, and bans are reversible, so a confirmation prompt would be
// friction without safety value.
export function UnbanButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = getAdminToken();
      const res = await fetch(
        `${API_URL}/admin/featured/banned-bidders/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unban failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="text-xs hover:underline"
        style={{
          color: busy ? 'var(--text-tertiary)' : 'var(--red)',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: busy ? 'wait' : 'pointer',
          textAlign: 'left',
        }}
      >
        {busy ? 'Unbanning…' : 'Unban'}
      </button>
      {error && (
        <span className="text-xs" style={{ color: 'var(--red)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
