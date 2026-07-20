'use client';

// One public seller reply per review (posted from the trust dashboard).
// Shows the existing reply read-only once made — the backend enforces
// once-only + the contact-detail filter.

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export function RatingReply({
  ratingId,
  existing,
}: {
  ratingId: string;
  existing: string | null;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existing) {
    return (
      <div className="mt-2 pl-3 py-1" style={{ borderLeft: '2px solid var(--border)' }}>
        <p className="text-[11px] mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Your response
        </p>
        <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
          {existing}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs mt-1"
        style={{ color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Reply publicly →
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch(`${API_URL}/ratings/${ratingId}/response`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ response: text.trim() }),
      });
      const body = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) throw new Error(body?.message ?? 'Could not post the reply');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Your one public reply — shown under the review on your profile. Stay professional; a composed reply builds more trust than a perfect score."
        className="w-full text-xs px-2.5 py-2 rounded-[6px]"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
          resize: 'vertical',
          outline: 'none',
        }}
      />
      {error && (
        <p className="text-xs m-0" style={{ color: 'var(--red)' }}>{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || text.trim().length < 3}
          onClick={() => void submit()}
          className="text-xs px-3 py-1.5 rounded-[5px]"
          style={{
            background: 'var(--red)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            opacity: busy || text.trim().length < 3 ? 0.5 : 1,
          }}
        >
          {busy ? 'Posting…' : 'Post reply (permanent)'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1.5 rounded-[5px]"
          style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
