'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignInButton, useAuth, useUser } from '@clerk/nextjs';
import { apiFetch } from '@/lib/api';
import { WantedAdCard, WantedResponseView } from '@/lib/types';
import { formatPrice, PROVINCE_LABELS } from '@/lib/utils';
import { timeAgo } from '@/lib/notifications';
import { PageReveal } from '@/components/page-reveal';
import { budgetLabel } from '../wanted-card';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface MyListingLean {
  id: string;
  title: string;
  status: string;
  price: number | null;
}

// Wanted-ad detail. Three views on one page:
//   - anyone: the ad itself
//   - a seller: "I have this" respond box (message + link own ACTIVE listing)
//   - the owner: responses inbox (messages + linked listings) + Close
// Ownership is decided SERVER-side — the client simply tries the owner-only
// responses endpoint; 403 means "not yours".
export default function WantedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [ad, setAd] = useState<WantedAdCard | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [responses, setResponses] = useState<WantedResponseView[]>([]);
  const [myState, setMyState] = useState<{
    responded: boolean;
    remaining: number;
  } | null>(null);
  const [myListings, setMyListings] = useState<MyListingLean[]>([]);

  const [message, setMessage] = useState('');
  const [listingId, setListingId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [closing, setClosing] = useState(false);

  // Public ad detail.
  useEffect(() => {
    let cancelled = false;
    apiFetch<WantedAdCard>(`/wanted/${id}`)
      .then((data) => {
        if (!cancelled) setAd(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Authed extras: owner check (+ responses) OR my respond-state + listings.
  const loadAuthed = useCallback(async () => {
    if (!isSignedIn) return;
    const token = await getToken();
    const authHeaders = { Authorization: `Bearer ${token}` };

    const respRes = await fetch(`${API_URL}/wanted/${id}/responses`, {
      headers: authHeaders,
      cache: 'no-store',
    });
    if (respRes.ok) {
      setIsOwner(true);
      setResponses(await respRes.json());
      return;
    }

    // Not the owner — load respond-state + my active listings for the box.
    const [stateRes, mineRes] = await Promise.all([
      fetch(`${API_URL}/wanted/${id}/my-response`, {
        headers: authHeaders,
        cache: 'no-store',
      }),
      fetch(`${API_URL}/listings/mine`, {
        headers: authHeaders,
        cache: 'no-store',
      }),
    ]);
    if (stateRes.ok) setMyState(await stateRes.json());
    if (mineRes.ok) {
      const mine: MyListingLean[] = await mineRes.json();
      setMyListings(mine.filter((l) => l.status === 'ACTIVE'));
    }
  }, [getToken, id, isSignedIn]);

  useEffect(() => {
    void loadAuthed().catch(() => {
      /* authed extras are progressive enhancement */
    });
  }, [loadAuthed]);

  async function onRespond(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wanted/${id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: message.trim(),
          listingId: listingId || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          (body && (body.message?.message ?? body.message)) ||
            'Could not send your response — please try again.',
        );
        return;
      }
      setSent(true);
      setMessage('');
      setListingId('');
      void loadAuthed().catch(() => {});
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onClose() {
    if (!window.confirm('Close this wanted ad? Sellers will no longer be able to respond.')) {
      return;
    }
    setClosing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wanted/${id}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) router.push('/wanted');
    } finally {
      setClosing(false);
    }
  }

  if (notFound) {
    return (
      <main className="max-w-[760px] mx-auto px-4 py-16 text-center">
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          This wanted ad no longer exists.
        </p>
        <Link href="/wanted" className="text-sm" style={{ color: 'var(--red)' }}>
          ← Back to Wanted
        </Link>
      </main>
    );
  }

  if (!ad) {
    return (
      <main className="max-w-[760px] mx-auto px-4 py-16 text-center">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      </main>
    );
  }

  const open = ad.status === 'ACTIVE';

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 8,
  };
  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
  };

  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <PageReveal variant="slide-up">
        <nav data-reveal className="mb-4 text-sm">
          <Link href="/wanted" style={{ color: 'var(--text-tertiary)' }}>
            ← Wanted
          </Link>
        </nav>

        {/* The ad */}
        <article data-reveal className="p-5 mb-6" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide"
              style={{ background: 'rgba(200,16,46,0.14)', color: 'var(--red)' }}
            >
              Wanted
            </span>
            {ad.categoryName && (
              <span
                className="px-2 py-0.5 rounded-full text-[11px]"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {ad.categoryName}
              </span>
            )}
            {!open && (
              <span
                className="px-2 py-0.5 rounded-full text-[11px] uppercase"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-tertiary)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {ad.status === 'CLOSED' ? 'Closed' : 'Expired'}
              </span>
            )}
          </div>

          <h1
            className="text-xl mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {ad.title}
          </h1>
          <p
            className="text-sm mb-4 whitespace-pre-wrap"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
          >
            {ad.description}
          </p>

          <div
            className="flex flex-wrap gap-x-6 gap-y-1 text-sm pt-3"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
              {budgetLabel(ad)}
            </span>
            {ad.province && (
              <span style={{ color: 'var(--text-tertiary)' }}>
                {PROVINCE_LABELS[ad.province] ?? ad.province}
              </span>
            )}
            <span style={{ color: 'var(--text-tertiary)' }}>
              Posted {timeAgo(ad.createdAt)} by {ad.ownerUsername}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              {ad.responseCount} response{ad.responseCount === 1 ? '' : 's'}
            </span>
          </div>
        </article>

        {/* Owner view — responses inbox + close */}
        {isOwner && (
          <section data-reveal className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2
                className="text-base font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Responses to your ad
              </h2>
              {open && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={closing}
                  className="px-3 py-1.5 rounded-[6px] text-xs"
                  style={{
                    background: 'transparent',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-tertiary)',
                    cursor: closing ? 'wait' : 'pointer',
                  }}
                >
                  {closing ? 'Closing…' : 'Close this ad'}
                </button>
              )}
            </div>

            {responses.length === 0 ? (
              <div className="p-5 text-sm" style={{ ...cardStyle, color: 'var(--text-tertiary)' }}>
                No responses yet — sellers get notified as they browse. Hang
                tight.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {responses.map((r) => (
                  <div key={r.id} className="p-4" style={cardStyle}>
                    <div className="flex items-center justify-between mb-2 text-xs">
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {r.responderUsername}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {timeAgo(r.createdAt)}
                      </span>
                    </div>
                    <p
                      className="text-sm mb-3 whitespace-pre-wrap"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {r.message}
                    </p>
                    {r.listing && (
                      <Link
                        href={`/listings/${r.listing.id}`}
                        className="flex items-center gap-3 p-3 rounded-[6px] transition-colors hover:border-[var(--red)]"
                        style={{
                          background: 'var(--bg-inset)',
                          border: '0.5px solid var(--border)',
                        }}
                      >
                        {r.listing.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.listing.imageUrl}
                            alt={r.listing.title}
                            className="w-14 h-14 rounded-[4px] object-cover flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p
                            className="text-sm truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {r.listing.title}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--red)', fontWeight: 600 }}>
                            {r.listing.price != null
                              ? formatPrice(r.listing.price)
                              : 'See listing'}
                            {r.listing.status !== 'ACTIVE' && (
                              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                                {' '}
                                · no longer active
                              </span>
                            )}
                          </p>
                        </div>
                        <span
                          className="ml-auto text-xs flex-shrink-0"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          View →
                        </span>
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Seller view — respond box */}
        {!isOwner && open && (
          <section data-reveal className="p-5" style={cardStyle}>
            <h2
              className="text-base font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Got one for sale?
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Respond with one of your live listings — the buyer purchases
              through Gun Galore with payment held until delivery, as always.
            </p>

            {isLoaded && !isSignedIn ? (
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="w-full py-3 rounded-[6px] text-sm font-medium"
                  style={{ background: 'var(--red)', color: '#fff' }}
                >
                  Sign in to respond
                </button>
              </SignInButton>
            ) : sent ? (
              <div
                className="rounded-[6px] px-3 py-3 text-sm"
                style={{
                  background: 'rgba(47,158,107,0.12)',
                  border: '0.5px solid #2f9e6b',
                  color: '#2f9e6b',
                }}
              >
                Response sent — the buyer has been notified.
                {myState && myState.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="ml-2 underline"
                    style={{ color: '#2f9e6b' }}
                  >
                    Send another
                  </button>
                )}
              </div>
            ) : (
              <form onSubmit={onRespond} className="flex flex-col gap-3">
                {myListings.length > 0 ? (
                  <div>
                    <label
                      htmlFor="w-listing"
                      className="block text-xs mb-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Attach one of your live listings (recommended)
                    </label>
                    <select
                      id="w-listing"
                      value={listingId}
                      onChange={(e) => setListingId(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">No listing — just a message</option>
                      {myListings.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                          {l.price != null ? ` — ${formatPrice(l.price)}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    No live listings to attach yet —{' '}
                    <Link
                      href="/listings/new"
                      style={{ color: 'var(--red)' }}
                    >
                      list the item first (free, no upfront fees)
                    </Link>{' '}
                    or send a message below.
                  </p>
                )}

                <textarea
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={3}
                  placeholder="Tell the buyer about your item — condition, extras, why it fits what they're after. (No phone numbers or emails.)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  aria-label="Your response message"
                />

                {error && (
                  <div
                    role="alert"
                    className="rounded-[6px] px-3 py-2.5 text-sm"
                    style={{
                      background: 'rgba(200,16,46,0.10)',
                      border: '0.5px solid var(--red)',
                      color: 'var(--red)',
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || (myState !== null && myState.remaining === 0)}
                  className="py-3 rounded-[6px] text-sm font-semibold"
                  style={{
                    background: 'var(--red)',
                    color: '#fff',
                    opacity: submitting ? 0.7 : 1,
                    cursor: submitting ? 'wait' : 'pointer',
                  }}
                >
                  {myState !== null && myState.remaining === 0
                    ? 'Response limit reached for this ad'
                    : submitting
                      ? 'Sending…'
                      : 'Send response'}
                </button>
              </form>
            )}
          </section>
        )}

        {!isOwner && !open && (
          <div
            data-reveal
            className="p-5 text-sm text-center"
            style={{ ...cardStyle, color: 'var(--text-tertiary)' }}
          >
            This wanted ad is {ad.status === 'CLOSED' ? 'closed' : 'expired'} —
            responses are no longer accepted.
          </div>
        )}
      </PageReveal>
    </main>
  );
}
