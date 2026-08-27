'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface SellerQuestion {
  id: string;
  question: string;
  answer: string | null;
  status:
    | 'AWAITING_SELLER_ANSWER'
    | 'AUTO_ANSWERED'
    | 'ANSWERED_BY_SELLER';
  answeredAt: string | null;
  autoAnsweredFromQuestionId: string | null;
  createdAt: string;
  listing: { id: string; title: string };
  asker: { firstName: string | null; username: string | null };
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function statusBadge(s: SellerQuestion['status']) {
  switch (s) {
    case 'AWAITING_SELLER_ANSWER':
      return { label: 'Needs you', color: '#f59e0b' };
    case 'AUTO_ANSWERED':
      return { label: 'AI replied', color: '#6366f1' };
    case 'ANSWERED_BY_SELLER':
      return { label: 'Answered', color: '#00a03c' };
  }
}

export function SellerQuestionsCard() {
  const { getToken, isSignedIn } = useAuth();
  const [items, setItems] = useState<SellerQuestion[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/me/questions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        setItems([]);
        return;
      }
      setItems((await res.json()) as SellerQuestion[]);
    } catch {
      setItems([]);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (id: string) => {
    const text = (draft[id] ?? '').trim();
    if (!text) return;
    setBusyId(id);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/me/questions/${id}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ answer: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setErr(data.message ?? 'Could not save answer');
        return;
      }
      setDraft((d) => ({ ...d, [id]: '' }));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const flagAi = async (id: string) => {
    if (
      !confirm(
        'Mark this AI answer as not right? The original answer it was based on will stop being re-used, and the question will reappear for you to answer manually.',
      )
    )
      return;
    setBusyId(id);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/me/questions/${id}/flag-auto-answer`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!res.ok) {
        setErr('Could not flag');
        return;
      }
      void load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      data-reveal
      className="rounded-[8px] p-5"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-4"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
        }}
      >
        Buyer questions
      </p>

      {items === null ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No questions on your listings yet.
        </p>
      ) : (
        <ol className="space-y-4">
          {items.map((q) => {
            const badge = statusBadge(q.status);
            return (
              <li
                key={q.id}
                className="pb-3"
                style={{ borderBottom: '0.5px solid var(--border-divider)' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <Link
                    href={`/listings/${q.listing.id}`}
                    className="text-xs"
                    style={{
                      color: 'var(--text-tertiary)',
                      textDecoration: 'none',
                    }}
                  >
                    {q.listing.title.slice(0, 40)}
                    {q.listing.title.length > 40 ? '…' : ''}
                  </Link>
                  <span
                    className="text-[10px] uppercase px-1.5 py-0.5 rounded-[3px]"
                    style={{
                      background: `color-mix(in srgb, ${badge.color} 9%, transparent)`,
                      color: badge.color,
                      border: `0.5px solid color-mix(in srgb, ${badge.color} 25%, transparent)`,
                      letterSpacing: '0.05em',
                    }}
                  >
                    {badge.label}
                  </span>
                </div>

                <p
                  className="text-sm leading-snug mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>Q. </span>
                  {q.question}
                </p>

                {q.answer && (
                  <p
                    className="text-sm leading-snug mb-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span style={{ color: 'var(--text-tertiary)' }}>A. </span>
                    {q.answer}
                  </p>
                )}

                <p
                  className="text-[11px] mb-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Asked {whenLabel(q.createdAt)} ·{' '}
                  {q.asker.username ?? 'Anonymous'}
                </p>

                {q.status === 'AUTO_ANSWERED' && (
                  <button
                    type="button"
                    onClick={() => flagAi(q.id)}
                    disabled={busyId === q.id}
                    className="text-[11px]"
                    style={{
                      color: 'var(--red)',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: busyId === q.id ? 'wait' : 'pointer',
                    }}
                  >
                    The AI got this wrong — let me answer it
                  </button>
                )}

                {q.status === 'AWAITING_SELLER_ANSWER' && (
                  <div className="mt-1">
                    <textarea
                      rows={2}
                      maxLength={1000}
                      placeholder="Your answer — keep it factual about the product."
                      value={draft[q.id] ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [q.id]: e.target.value }))
                      }
                      className="w-full rounded-[6px] px-3 py-2 text-sm resize-y"
                      style={{
                        background: 'var(--bg-inset)',
                        border: '0.5px solid var(--border)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        type="button"
                        onClick={() => answer(q.id)}
                        disabled={
                          busyId === q.id ||
                          (draft[q.id] ?? '').trim().length === 0
                        }
                        className="text-xs px-3 py-1.5 rounded-[4px]"
                        style={{
                          background: 'var(--red)',
                          color: '#fff',
                          fontWeight: 500,
                          border: 'none',
                          opacity:
                            busyId === q.id ||
                            (draft[q.id] ?? '').trim().length === 0
                              ? 0.5
                              : 1,
                          cursor:
                            busyId === q.id ||
                            (draft[q.id] ?? '').trim().length === 0
                              ? 'not-allowed'
                              : 'pointer',
                        }}
                      >
                        {busyId === q.id ? 'Saving…' : 'Send answer'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {err && (
        <p className="text-xs mt-3" style={{ color: 'var(--red)' }}>
          {err}
        </p>
      )}
    </div>
  );
}
