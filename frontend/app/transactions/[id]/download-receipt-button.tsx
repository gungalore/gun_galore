'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

// Buyer downloads their Gun Galore purchase receipt (PDF). The endpoint is
// Clerk-guarded, so we fetch with the session token and trigger a blob
// download (a plain <a href> wouldn't carry the Authorization header).
export function DownloadReceiptButton({
  transactionId,
}: {
  transactionId: string;
}) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/transactions/${transactionId}/receipt`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gun-galore-receipt-${transactionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="w-full py-2 rounded-[6px] text-sm"
        style={{
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border)',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Preparing…' : '↓ Download receipt (PDF)'}
      </button>
      {error && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
