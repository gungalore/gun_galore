'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Reads the admin JWT from the (non-HttpOnly) cookie set by the login
// flow — matches the pattern used by review-actions.tsx and
// transaction-actions.tsx elsewhere in the admin panel.
function getAdminToken(): string {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRefresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/kyc/balance/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? `Refresh failed (HTTP ${res.status})`);
      }
      // Re-fetch the server component above so the new balance + timestamp
      // render straight away — saves a manual hard reload.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh balance');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="text-sm px-4 py-2 rounded-[6px]"
        style={{
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border)',
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
      {error && (
        <p
          className="text-xs"
          style={{ color: 'var(--red)', maxWidth: 200, textAlign: 'right' }}
        >
          {error}
        </p>
      )}
    </>
  );
}
