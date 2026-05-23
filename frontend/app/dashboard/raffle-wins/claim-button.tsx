'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function ClaimButton({ winnerId }: { winnerId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleClaim() {
    if (!confirm('Confirm you wish to claim this prize?')) return;
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/raffles/wins/${winnerId}/claim`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClaim}
        disabled={submitting}
        className="block w-full py-2.5 rounded-[6px] text-sm font-medium"
        style={{
          background: submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Claiming…' : 'Claim my prize'}
      </button>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
