'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { type FeedLiker, fetchPostLikes } from '../../lib/community-api';
import { useScrollLock } from '../../lib/use-scroll-lock';

/**
 * "Liked by" — the list of members who liked a post, newest first. Opens from
 * the like count on any post (operator decision 2026-10-10: visible to the
 * whole member base). Only the username and privacy-gated avatar are shown;
 * every row links to that member's community profile.
 */
export function LikedBySheet({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const [likers, setLikers] = useState<FeedLiker[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // getToken is a fresh identity each render in the test mock (and callers pass
  // plain objects); read it through a ref so the mount fetch runs exactly once
  // and a re-render cannot stomp a loaded page. Same convention as
  // channel-prefs-sheet.tsx.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useScrollLock(true);

  const load = useCallback(
    async (before?: string) => {
      const token = await getTokenRef.current();
      if (!token) return;
      const res = await fetchPostLikes(token, postId, before);
      setLikers((prev) => (before ? [...prev, ...res.likers] : res.likers));
      setNextBefore(res.nextBefore);
    },
    [postId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextBefore);
    } catch {
      /* keep what we already have */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Liked by"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm max-h-[70vh] flex flex-col rounded-t-2xl sm:rounded-2xl outline-none"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <header
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <h2
            className="text-[15px] font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Liked by
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="gg-press px-2 py-1 rounded text-[15px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ✕
          </button>
        </header>

        <div className="overflow-y-auto px-2 py-1">
          {loading ? (
            <p
              className="px-3 py-6 text-center text-[13px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Loading…
            </p>
          ) : failed ? (
            <p
              className="px-3 py-6 text-center text-[13px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Could not load likes.
            </p>
          ) : likers.length === 0 ? (
            <p
              className="px-3 py-6 text-center text-[13px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No likes yet.
            </p>
          ) : (
            <>
              {likers.map((l) => (
                <Link
                  key={l.id}
                  href={`/community/u/${encodeURIComponent(l.username)}`}
                  onClick={onClose}
                  className="gg-press flex items-center gap-3 px-2 py-2 rounded-[6px]"
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0"
                    style={{
                      background: 'var(--bg-inset)',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                    }}
                  >
                    {l.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.avatarUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (l.username?.[0] ?? '?').toUpperCase()
                    )}
                  </span>
                  <span
                    className="text-[14px] truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {l.username}
                  </span>
                  {l.isVerifiedExpert && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: 'var(--bg-inset)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Expert
                    </span>
                  )}
                </Link>
              ))}
              {nextBefore && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="gg-press w-full py-2 text-[13px]"
                  style={{ color: 'var(--red)' }}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
