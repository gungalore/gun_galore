'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function CancelButton({ listingId }: { listingId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    setBusy(true);
    try {
      const token = await getToken();
      await fetch(`${API_URL}/listings/${listingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      router.refresh();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={handleCancel}
          disabled={busy}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
        >
          Confirm
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="px-2.5 py-1 rounded text-xs"
          style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="px-2.5 py-1 rounded text-xs"
      style={{ color: 'var(--red)', border: '0.5px solid var(--red)40' }}
    >
      Cancel
    </button>
  );
}
