'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
  resize: 'none',
};

export function RatingWidget({ transactionId }: { transactionId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'rgba(0,160,60,0.10)', color: '#00a03c', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        Thank you for your rating.
      </div>
    );
  }

  async function handleSubmit() {
    if (!stars) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stars, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  const display = hovered || stars;

  return (
    <div className="space-y-3">
      {/* Star picker */}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            style={{
              fontSize: '24px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: n <= display ? '#f59e0b' : 'var(--border)',
              padding: '0 2px',
              lineHeight: 1,
            }}
          >
            ★
          </button>
        ))}
        {stars > 0 && (
          <span className="text-sm ml-2 self-center" style={{ color: 'var(--text-tertiary)' }}>
            {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][stars]}
          </span>
        )}
      </div>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Leave a comment (optional)"
        rows={2}
        maxLength={500}
        style={inputStyle}
      />

      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!stars || submitting}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: !stars || submitting ? 'var(--bg-inset)' : 'var(--red)',
          color: !stars || submitting ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          cursor: !stars || submitting ? 'not-allowed' : 'pointer',
          fontWeight: 500,
        }}
      >
        {submitting ? 'Submitting…' : 'Submit rating'}
      </button>
    </div>
  );
}
