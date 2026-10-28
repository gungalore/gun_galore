'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface InquiryListRow {
  id: string;
  listing: { id: string; title: string; status: string };
  role: 'BUYER' | 'SELLER';
  counterparty: {
    id: string;
    username: string | null;
    avatarUrl?: string | null;
  };
  lastMessageAt: string;
  unread: number;
  lastMessage: {
    preview: string;
    senderId: string;
    createdAt: string;
  } | null;
}

interface InquiryMedia {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
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

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/**
 * Dashboard inbox for private listing inquiries ("Contact seller").
 *
 * Shows both directions (as buyer and as seller), oldest → newest per thread.
 * Sellers can attach photos or a video when replying; buyers cannot. Text is
 * moderated exactly like transaction messages — contact details auto-strip,
 * abuse is blocked.
 */
export function SellerQuestionsCard({
  initialInquiryId = null,
}: {
  /** Deep link target from /messages?inquiry=<id>. */
  initialInquiryId?: string | null;
}) {
  const { getToken, isSignedIn } = useAuth();
  const [items, setItems] = useState<InquiryListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoOpenedId, setAutoOpenedId] = useState<string | null>(null);
  const [thread, setThread] = useState<InquiryThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachImages, setAttachImages] = useState<File[]>([]);
  const [attachVideo, setAttachVideo] = useState<File | null>(null);

  const loadList = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/me/inquiries`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        setFailed(true);
        setItems([]);
        return;
      }
      setFailed(false);
      setItems((await res.json()) as InquiryListRow[]);
    } catch {
      setFailed(true);
      setItems([]);
    }
  }, [getToken, isSignedIn]);

  const loadThread = useCallback(
    async (id: string) => {
      setThreadLoading(true);
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/me/inquiries/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        });
        if (!res.ok) {
          setErr('Could not load that conversation.');
          return;
        }
        setThread((await res.json()) as InquiryThread);
        void loadList();
      } catch {
        setErr('Could not load that conversation.');
      } finally {
        setThreadLoading(false);
      }
    },
    [getToken, loadList],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Light polling so a new buyer message appears without a manual refresh.
  useEffect(() => {
    if (!isSignedIn) return;
    const t = setInterval(() => {
      void loadList();
      if (selectedId) void loadThread(selectedId);
    }, 20_000);
    return () => clearInterval(t);
  }, [isSignedIn, loadList, loadThread, selectedId]);

  const open = useCallback(
    (id: string) => {
      setSelectedId(id);
      setThread(null);
      setDraft('');
      setAttachImages([]);
      setAttachVideo(null);
      setErr(null);
      void loadThread(id);
    },
    [loadThread],
  );

  // A notification, email CTA or account-menu deep link carries the thread id.
  // Open it as soon as auth is ready, without making the member hunt through
  // the list. The id guard stops the effect re-opening a thread the member has
  // deliberately closed while the URL still carries the old id.
  useEffect(() => {
    if (!isSignedIn || !initialInquiryId) return;
    if (autoOpenedId === initialInquiryId) return;
    setAutoOpenedId(initialInquiryId);
    open(initialInquiryId);
  }, [autoOpenedId, initialInquiryId, isSignedIn, open]);

  const sendText = async () => {
    const content = draft.trim();
    if (!content || !selectedId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/me/inquiries/${selectedId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        setErr(
          Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message ?? 'Could not send your reply.',
        );
        return;
      }
      setDraft('');
      await loadThread(selectedId);
    } finally {
      setBusy(false);
    }
  };

  const sendMedia = async () => {
    if (!selectedId || busy) return;
    if (attachImages.length === 0 && !attachVideo) return;
    setBusy(true);
    setErr(null);
    try {
      const token = await getToken();
      const fd = new FormData();
      for (const f of attachImages) fd.append('images', f);
      if (attachVideo) fd.append('video', attachVideo);
      const res = await fetch(`${API_URL}/me/inquiries/${selectedId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        setErr(
          Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message ??
                'That media was not accepted. Photos and video are screened for contact details.',
        );
        return;
      }
      setAttachImages([]);
      setAttachVideo(null);
      await loadThread(selectedId);
    } finally {
      setBusy(false);
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
        Messages
      </p>

      {items === null ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : failed ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          We could not load your inquiries just now — this is not the same as
          having none. Refresh to try again.
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No messages yet. When someone contacts you about a listing, it
          lands here.
        </p>
      ) : selectedId && thread ? (
        <div>
          {/* Thread header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <Link
                href={`/listings/${thread.listing.id}`}
                className="text-sm"
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                {thread.listing.title.slice(0, 60)}
                {thread.listing.title.length > 60 ? '…' : ''}
              </Link>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {thread.role === 'SELLER'
                  ? `Buyer: ${thread.buyer.username ?? 'Anonymous'}`
                  : `Seller: ${thread.seller.username ?? 'Anonymous'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setThread(null);
                setErr(null);
              }}
              className="text-[11px]"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ← All inquiries
            </button>
          </div>

          {threadLoading && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Loading…
            </p>
          )}

          <ol className="space-y-2 mb-3 max-h-[340px] overflow-y-auto">
            {thread.messages.map((m) => {
              const mineByRole =
                thread.role === 'SELLER'
                  ? m.senderId === thread.seller.id
                  : m.senderId === thread.buyer.id;
              return (
                <li
                  key={m.id}
                  className="rounded-[6px] px-3 py-2"
                  style={{
                    background: mineByRole ? 'var(--bg-inset)' : 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                    marginLeft: mineByRole ? 20 : 0,
                    marginRight: mineByRole ? 0 : 20,
                  }}
                >
                  <p
                    className="text-[10px] uppercase tracking-wide mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {mineByRole
                      ? 'You'
                      : thread.role === 'SELLER'
                        ? 'Buyer'
                        : 'Seller'}
                    {m.wasModerated ? ' · contact details removed' : ''}
                    {' · '}
                    {whenLabel(m.createdAt)}
                  </p>
                  {m.content && (
                    <p
                      className="text-sm whitespace-pre-wrap"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {m.content}
                    </p>
                  )}
                  {m.media.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.media.map((x) =>
                        x.kind === 'IMAGE' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={x.id}
                            src={x.url}
                            alt=""
                            style={{
                              width: '100%',
                              borderRadius: 6,
                              display: 'block',
                            }}
                          />
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
                              maxHeight: 280,
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

          <textarea
            rows={2}
            maxLength={2000}
            placeholder={
              thread.role === 'SELLER'
                ? 'Reply to the buyer — no phone numbers, emails or links.'
                : 'Message the seller — no phone numbers, emails or links.'
            }
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
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={sendText}
              disabled={busy || draft.trim().length === 0}
              className="text-xs px-3 py-1.5 rounded-[4px]"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                border: 'none',
                opacity: busy || draft.trim().length === 0 ? 0.5 : 1,
                cursor:
                  busy || draft.trim().length === 0
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>

          {/* Seller-only media reply */}
          {thread.role === 'SELLER' && (
            <div
              className="mt-3 pt-3"
              style={{ borderTop: '0.5px solid var(--border-divider)' }}
            >
              <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Answer with photos or a video (screened before sending):
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="text-[11px] px-2 py-1 rounded-[4px]"
                  style={{
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Photos
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) =>
                      setAttachImages(Array.from(e.target.files ?? []).slice(0, 4))
                    }
                  />
                </label>
                <label
                  className="text-[11px] px-2 py-1 rounded-[4px]"
                  style={{
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Video
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    style={{ display: 'none' }}
                    onChange={(e) => setAttachVideo(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="button"
                  onClick={sendMedia}
                  disabled={
                    busy || (attachImages.length === 0 && !attachVideo)
                  }
                  className="text-[11px] px-2 py-1 rounded-[4px]"
                  style={{
                    border: '0.5px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor:
                      busy || (attachImages.length === 0 && !attachVideo)
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      busy || (attachImages.length === 0 && !attachVideo)
                        ? 0.5
                        : 1,
                  }}
                >
                  Attach &amp; send
                </button>
              </div>
              {(attachImages.length > 0 || attachVideo) && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {attachImages.length > 0
                    ? `${attachImages.length} photo${attachImages.length === 1 ? '' : 's'}`
                    : ''}
                  {attachImages.length > 0 && attachVideo ? ' · ' : ''}
                  {attachVideo ? attachVideo.name : ''}
                </p>
              )}
            </div>
          )}

          {err && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {err}
            </p>
          )}
        </div>
      ) : selectedId ? (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {threadLoading ? 'Opening the conversation…' : 'No conversation to show.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setThread(null);
              setErr(null);
            }}
            className="text-[11px]"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--red)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ← All inquiries
          </button>
          {err && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {err}
            </p>
          )}
        </div>
      ) : (
        <ol className="space-y-3">
          {items.map((q) => (
            <li
              key={q.id}
              className="pb-3"
              style={{ borderBottom: '0.5px solid var(--border-divider)' }}
            >
              <button
                type="button"
                onClick={() => open(q.id)}
                className="w-full text-left"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className="text-xs truncate"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {q.listing.title.slice(0, 40)}
                    {q.listing.title.length > 40 ? '…' : ''}
                  </span>
                  <span
                    className="text-[10px] uppercase px-1.5 py-0.5 rounded-[3px] shrink-0"
                    style={{
                      background:
                        q.role === 'SELLER'
                          ? 'rgba(245,158,11,0.10)'
                          : 'var(--bg-inset)',
                      color:
                        q.role === 'SELLER'
                          ? 'var(--warning)'
                          : 'var(--text-tertiary)',
                      border: '0.5px solid var(--border)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {q.role === 'SELLER' ? 'Buyer asked' : 'You asked'}
                    {q.unread > 0 ? ` · ${q.unread} new` : ''}
                  </span>
                </div>
                <p
                  className="text-sm leading-snug mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {q.lastMessage?.preview || 'No messages yet'}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {q.role === 'SELLER'
                    ? q.counterparty.username ?? 'Anonymous buyer'
                    : q.counterparty.username ?? 'Seller'}
                  {' · '}
                  {whenLabel(q.lastMessageAt)}
                </p>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
