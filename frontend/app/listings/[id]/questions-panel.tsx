'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SignInButton, useAuth, useUser } from '@clerk/nextjs';
import { UserBadges } from '@/components/user-badges';
import type { SubscriptionTier } from '@/lib/types';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface PublicQuestion {
  id: string;
  question: string;
  answer: string;
  answeredAt: string;
  status: 'ANSWERED_BY_SELLER' | 'AUTO_ANSWERED';
  autoAnsweredFromQuestionId: string | null;
  // Phase E1 — username + badge fields surfaced beside each answerer.
  // A Pro-tier or verified-expert seller's reply is visually weightier
  // than a FREE seller's, which is the whole point of the badge.
  asker: {
    username: string | null;
    subscriptionTier?: SubscriptionTier;
    isVerifiedExpert?: boolean;
  };
  answeredByUser: {
    username: string | null;
    subscriptionTier?: SubscriptionTier;
    isVerifiedExpert?: boolean;
  } | null;
}

interface AskResponse {
  status: 'AUTO_ANSWERED' | 'AWAITING_SELLER_ANSWER' | 'REJECTED';
  publicReason?: string;
  questionId?: string;
}

// Seller-side row from GET /me/questions (the same endpoint the dashboard
// card uses). Only the fields the owner banner needs.
interface SellerQuestionRow {
  id: string;
  question: string;
  status: 'AWAITING_SELLER_ANSWER' | 'AUTO_ANSWERED' | 'ANSWERED_BY_SELLER';
  createdAt: string;
  listing: { id: string };
}

// How long a question has been sitting unanswered. Sellers respond to "3
// days ago" in a way they don't respond to a bare count.
function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Public Q&A surfaces — username only, no @ prefix. Real names are
// platform-policy off the public surface.
function whoAsked(q: PublicQuestion): string {
  return q.asker.username ?? 'Anonymous buyer';
}

function whoAnswered(q: PublicQuestion): string {
  if (q.status === 'AUTO_ANSWERED') return 'All Outdoor AI';
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

  // Owner-only: questions on THIS listing still waiting on the seller. The
  // public list below only ever contains ANSWERED rows, so a seller standing
  // on their own listing had no way to know buyers were waiting — and slow
  // answers are the thing that kills the sale. null = not loaded yet.
  const [pending, setPending] = useState<SellerQuestionRow[] | null>(null);

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

  // /me/questions returns every question across the seller's listings (it
  // powers the dashboard card), so filter to this listing client-side —
  // no new endpoint, no new query param.
  useEffect(() => {
    if (!isOwner) {
      setPending(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/me/questions`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        });
        if (!res.ok) {
          if (alive) setPending([]);
          return;
        }
        const rows = (await res.json()) as SellerQuestionRow[];
        if (alive) {
          setPending(
            rows.filter(
              (q) =>
                q.listing?.id === listingId &&
                q.status === 'AWAITING_SELLER_ANSWER',
            ),
          );
        }
      } catch {
        if (alive) setPending([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isOwner, getToken, listingId]);

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

      {/* Owner nudge — sits ABOVE the public list because an unanswered
          question is the seller's most conversion-critical to-do on this
          page, and the list below can only ever show answered ones. */}
      {isOwner && pending !== null && (
        pending.length > 0 ? (
          <div
            className="rounded-[6px] px-3 py-2.5 mb-3 text-xs"
            role="status"
            style={{
              background: 'rgba(245,158,11,0.10)',
              border: '0.5px solid #f59e0b',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
            }}
          >
            <p style={{ color: '#f59e0b', fontWeight: 600 }}>
              {pending.length} unanswered question
              {pending.length === 1 ? '' : 's'} on this listing
            </p>
            <ul className="mt-1.5 space-y-1">
              {pending.slice(0, 3).map((q) => (
                <li key={q.id} style={{ color: 'var(--text-primary)' }}>
                  &ldquo;{q.question}&rdquo;{' '}
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    — asked {waitingFor(q.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
            {pending.length > 3 && (
              <p className="mt-1" style={{ color: 'var(--text-tertiary)' }}>
                + {pending.length - 3} more.
              </p>
            )}
            <Link
              href="/dashboard#questions"
              className="inline-block mt-2 px-3 py-1.5 rounded-[4px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Answer from your dashboard →
            </Link>
            <p className="mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Buyers only see a question once you&apos;ve answered it.
            </p>
          </div>
        ) : (
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Nothing waiting on you. New buyer questions arrive here and are
            answered from your{' '}
            <Link href="/dashboard" style={{ color: 'var(--red)' }}>
              dashboard
            </Link>
            ; only answered ones show publicly.
          </p>
        )
      )}

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
                {whoAsked(q)}
                {/* Buyer badges — usually nothing, but if the asker is
                    a Pro / verified expert it shows they're an
                    informed buyer (some sellers treat that signal
                    as worth replying quickly to). */}
                <UserBadges
                  subscriptionTier={q.asker.subscriptionTier}
                  isVerifiedExpert={q.asker.isVerifiedExpert}
                />{' '}
                · {whoAnswered(q)}
                {q.status !== 'AUTO_ANSWERED' && q.answeredByUser && (
                  <UserBadges
                    subscriptionTier={q.answeredByUser.subscriptionTier}
                    isVerifiedExpert={q.answeredByUser.isVerifiedExpert}
                  />
                )}{' '}
                · {relativeDate(q.answeredAt)}
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
            // Asking a question is the commonest pre-purchase action for an
            // anonymous browser — a line of grey text was a dead end. Every
            // sibling panel (bid / offer / swap) offers a real modal sign-in
            // CTA, so this one does too.
            <SignInButton mode="modal">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-[4px]"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Sign in to ask a question
              </button>
            </SignInButton>
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
