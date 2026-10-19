'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SignInButton, useAuth, useUser } from '../../../lib/auth';
import { ImageLightbox } from '@/components/image-lightbox';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface InquiryMedia {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

interface InquiryMessage {
  id: string;
  senderId: string;
  content: string;
  wasModerated: boolean;
  createdAt: string;
  media: InquiryMedia[];
}

interface InquiryThread {
  id: string;
  role: 'BUYER' | 'SELLER';
  listing: { id: string; title: string; status: string };
  buyer: { id: string; username: string | null };
  seller: { id: string; username: string | null };
  messages: InquiryMessage[];
}

interface GetResponse {
  inquiry: InquiryThread | null;
  sellerInbox?: { open: number; unread: number };
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The private "Contact seller" panel on a listing.
 *
 * Replaced the public Q&A on 2026-10-19 (operator decision): buyers ask the
 * seller directly, the conversation stays on ALL Outdoor, and the SELLER can
 * answer with photos or a video. Text is auto-stripped of contact details;
 * seller media is screened before it is stored.
 *
 * The listing's owner does not chat here -- they reply from the dashboard, so
 * this panel shows them how many buyers are waiting instead.
 */
export function QuestionsPanel({
  listingId,
  sellerId,
}: {
  listingId: string;
  sellerId: string;
}) {
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const isOwner = isSignedIn && user?.id === sellerId;

  const [thread, setThread] = useState<InquiryThread | null>(null);
  const [sellerInbox, setSellerInbox] = useState<{
    open: number;
    unread: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{
    tone: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}/inquiry`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        // A signed-out race or a transient failure must not erase an already
        // rendered thread.
        setFailed(true);
        return;
      }
      setFailed(false);
      const data = (await res.json()) as GetResponse;
      setThread(data.inquiry ?? null);
      setSellerInbox(data.sellerInbox ?? null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, isSignedIn, listingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a thread is open so a seller's reply lands without a reload.
  useEffect(() => {
    if (!isSignedIn || isOwner || !thread) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [isSignedIn, isOwner, thread, load]);

  const onSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setToast(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/listings/${listingId}/inquiry/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ content }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!res.ok) {
        setToast({
          tone: 'err',
          text: data.message ?? 'Could not send your message.',
        });
        return;
      }
      setDraft('');
      await load();
    } catch {
      setToast({ tone: 'err', text: 'Network error - please retry.' });
    } finally {
      setSending(false);
    }
  };

  // All photos in the thread, in order, so the shared lightbox can page
  // through them exactly like a listing gallery.
  const threadImages = useMemo(
    () =>
      (thread?.messages ?? []).flatMap((m) =>
        m.media
          .filter((x) => x.kind === 'IMAGE')
          .map((x) => ({ id: x.id, url: x.url })),
      ),
    [thread],
  );

  const imageIndexFor = (mediaId: string) =>
    threadImages.findIndex((x) => x.id === mediaId);

  return (
    <div
      className="rounded-[6px] p-3 mb-4 text-sm"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
          }}
        >
          Contact seller
        </p>
        {thread && (
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Private | seller can send photos &amp; video
          </span>
        )}
      </div>

      {/* Owner -- no self-chat. Show the inbox summary + dashboard link. */}
      {isOwner ? (
        <div className="text-xs" style={{ lineHeight: 1.6 }}>
          {sellerInbox && sellerInbox.open > 0 ? (
            <>
              <p style={{ color: 'var(--warning)', fontWeight: 600 }}>
                {sellerInbox.open} buyer conversation
                {sellerInbox.open === 1 ? '' : 's'} on this listing
                {sellerInbox.unread > 0
                  ? ` | ${sellerInbox.unread} unread message${sellerInbox.unread === 1 ? '' : 's'}`
                  : ''}
              </p>
              <Link
                href="/dashboard#inquiries"
                className="inline-block mt-2 px-3 py-1.5 rounded-[4px]"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Reply from your dashboard -&gt;
              </Link>
              <p className="mt-2" style={{ color: 'var(--text-tertiary)' }}>
                You can attach photos or a video when you reply. Buyers can
                only send text.
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--text-tertiary)' }}>
              No buyer messages yet. Conversations arrive here and in your{' '}
              <Link href="/dashboard#inquiries" style={{ color: 'var(--red)' }}>
                dashboard
              </Link>
              .
            </p>
          )}
        </div>
      ) : !isSignedIn ? (
        <div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Ask the seller anything about this item -- they can reply with
            photos or a video.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded-[4px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign in to contact seller
            </button>
          </SignInButton>
        </div>
      ) : (
        <>
          {failed && (
            <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
              We could not load this conversation just now. Refresh to try
              again.
            </p>
          )}

          {loading && !thread && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Loading...
            </p>
          )}

          {/* Messages */}
          {thread && thread.messages.length > 0 && (
            <ol className="space-y-2 mb-3 max-h-[340px] overflow-y-auto">
              {thread.messages.map((m) => {
                const mine = m.senderId === user?.id;
                return (
                  <li
                    key={m.id}
                    className="rounded-[6px] px-3 py-2"
                    style={{
                      background: mine ? 'var(--bg-inset)' : 'var(--bg-card)',
                      border: '0.5px solid var(--border)',
                      marginLeft: mine ? 24 : 0,
                      marginRight: mine ? 0 : 24,
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-wide mb-1"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {mine ? 'You' : 'Seller'}
                      {m.wasModerated ? ' | contact details removed' : ''}
                      {' | '}
                      {relativeTime(m.createdAt)}
                    </p>
                    {m.content && (
                      <p
                        className="whitespace-pre-wrap"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {m.content}
                      </p>
                    )}
                    {m.media.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {m.media.map((x) =>
                          x.kind === 'IMAGE' ? (
                            <button
                              key={x.id}
                              type="button"
                              onClick={() => setViewerIdx(imageIndexFor(x.id))}
                              aria-label="Open photo"
                              style={{
                                display: 'block',
                                padding: 0,
                                border: 0,
                                background: 'transparent',
                                cursor: 'zoom-in',
                                width: '100%',
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={x.url}
                                alt=""
                                style={{
                                  width: '100%',
                                  borderRadius: 6,
                                  display: 'block',
                                }}
                              />
                            </button>
                          ) : (
                            <video
                              key={x.id}
                              src={x.playbackUrl ?? x.url}
                              poster={x.thumbnailUrl ?? undefined}
                              controls
                              playsInline
                              preload="metadata"
                              style={{
                                width: '100%',
                                maxHeight: 320,
                                background: '#000',
                                borderRadius: 6,
                                display: 'block',
                              }}
                            />
                          ),
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {(!thread || thread.messages.length === 0) && !loading && (
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Ask about condition, what&apos;s included, or anything you need
              to see -- the seller can reply with more photos or a short video.
            </p>
          )}

          {/* Composer */}
          <textarea
            rows={2}
            maxLength={2000}
            placeholder="Message the seller - no phone numbers, emails or links."
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
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {draft.length}/2000 | contact details are removed automatically
            </span>
            <button
              type="button"
              onClick={onSend}
              disabled={sending || draft.trim().length === 0}
              className="text-xs px-3 py-1.5 rounded-[4px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                opacity:
                  sending || draft.trim().length === 0 ? 0.5 : 1,
                cursor:
                  sending || draft.trim().length === 0
                    ? 'not-allowed'
                    : 'pointer',
                border: 'none',
              }}
            >
              {sending ? 'Sending...' : 'Send message'}
            </button>
          </div>
          {toast && (
            <p
              className="text-xs mt-2"
              style={{
                color: toast.tone === 'err' ? 'var(--red)' : 'var(--success)',
              }}
            >
              {toast.text}
            </p>
          )}
        </>
      )}

      {viewerIdx !== null && threadImages.length > 0 && (
        <ImageLightbox
          images={threadImages}
          startIndex={Math.max(0, viewerIdx)}
          title="Conversation photos"
          onClose={() => setViewerIdx(null)}
        />
      )}
    </div>
  );
}
