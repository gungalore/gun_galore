'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface PublicQuestion {
  id: string;
  question: string;
  answer: string;
  answeredAt: string;
  status: 'ANSWERED_BY_SELLER' | 'AUTO_ANSWERED';
  autoAnsweredFromQuestionId: string | null;
  asker: { firstName: string | null; username: string | null };
  answeredByUser: { firstName: string | null; username: string | null } | null;
}

interface AskResponse {
  status: 'AUTO_ANSWERED' | 'AWAITING_SELLER_ANSWER' | 'REJECTED';
  publicReason?: string;
  questionId?: string;
}

// Public Q&A surfaces — username only, no @ prefix. Real names are
// platform-policy off the public surface.
function whoAsked(q: PublicQuestion): string {
  return q.asker.username ?? 'Anonymous buyer';
}

function whoAnswered(q: PublicQuestion): string {
  if (q.status === 'AUTO_ANSWERED') return 'Gun Galore AI';
  return q.answeredByUser?.username ?? 'Seller';
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export function QuestionsPanel({
  listingId,
  sellerClerkId,
}: {
  listingId: string;
  sellerClerkId: string;
}) {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const isOwner = isSignedIn && user?.id === sellerClerkId;

  const [items, setItems] = useState<PublicQuestion[] | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    tone: 'ok' | 'err' | 'auto';
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/listings/${listingId}/questions`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setItems([]);
        return;
      }
      setItems((await res.json()) as PublicQuestion[]);
    } catch {
      setItems([]);
    }
  }, [listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAsk = async () => {
    const question = draft.trim();
    if (!question) return;
    setSubmitting(true);
    setToast(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}/questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as AskResponse | { message?: string };
      if (!res.ok) {
        const msg =
          (data as { message?: string }).message ?? 'Could not submit question';
        setToast({ tone: 'err', text: msg });
        return;
      }
      const r = data as AskResponse;
      if (r.status === 'REJECTED') {
        setToast({
          tone: 'err',
          text:
            r.publicReason ??
            'Keep questions to product details — no contact info, please.',
        });
        return;
      }
      if (r.status === 'AUTO_ANSWERED') {
        setToast({
          tone: 'auto',
          text: 'Answered using a previous reply from the seller.',
        });
      } else {
        setToast({
          tone: 'ok',
          text: 'Submitted. The seller will be notified.',
        });
      }
      setDraft('');
      void load();
    } catch {
      setToast({ tone: 'err', text: 'Network error — please retry.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-[6px] p-3 mb-4 text-sm"
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
        }}
      >
        Questions & answers
      </p>

      {/* Q&A list */}
      {items === null ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          No questions yet. Ask the seller something about the product.
        </p>
      ) : (
        <ol className="space-y-3 mb-3">
          {items.map((q) => (
            <li key={q.id} className="space-y-1">
              <p
                className="leading-snug"
                style={{ color: 'var(--text-primary)' }}
              >
                <span
                  style={{ color: 'var(--text-tertiary)', marginRight: 6 }}
                >
                  Q.
                </span>
                {q.question}
              </p>
              <p
                className="leading-snug"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span
                  style={{ color: 'var(--text-tertiary)', marginRight: 6 }}
                >
                  A.
                </span>
                {q.answer}
              </p>
              <p
                className="text-[11px]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {whoAsked(q)} · {whoAnswered(q)} · {relativeDate(q.answeredAt)}
                {q.status === 'AUTO_ANSWERED' && (
                  <span
                    className="ml-2"
                    title="Answered automatically from a previous question on this listing."
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    · from a previous question
                  </span>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* Composer — hidden for the listing owner. Sellers reply via the
          dashboard, not by talking to themselves. */}
      {!isOwner && (
        <>
          {!isSignedIn ? (
            <p
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Sign in to ask a question.
            </p>
          ) : (
            <div>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Ask the seller about the product — no contact details, no price negotiation."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-[6px] px-3 py-2 text-sm resize-y"
                style={{
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {draft.length}/500
                </span>
                <button
                  type="button"
                  onClick={onAsk}
                  disabled={submitting || draft.trim().length === 0}
                  className="text-xs px-3 py-1.5 rounded-[4px]"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontWeight: 500,
                    opacity:
                      submitting || draft.trim().length === 0 ? 0.5 : 1,
                    cursor:
                      submitting || draft.trim().length === 0
                        ? 'not-allowed'
                        : 'pointer',
                    border: 'none',
                  }}
                >
                  {submitting ? 'Sending…' : 'Ask seller'}
                </button>
              </div>
              {toast && (
                <p
                  className="text-xs mt-2"
                  style={{
                    color:
                      toast.tone === 'err'
                        ? 'var(--red)'
                        : toast.tone === 'auto'
                          ? '#6366f1'
                          : '#00a03c',
                  }}
                >
                  {toast.text}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
