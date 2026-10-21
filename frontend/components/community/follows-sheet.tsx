'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import {
  type SocialUser,
  fetchMyFollowers,
  fetchMyFollowing,
  removeFollower,
  unfollowUser,
} from '../../lib/community-api';
import { useScrollLock } from '../../lib/use-scroll-lock';
import { VerificationBadges } from '../verification-badges';

export type FollowsMode = 'followers' | 'following';

/**
 * The member's own follower/following list, opened from the Followers /
 * Following numbers on the control panel. Followers can be removed; members
 * being followed can be unfollowed in place. Rows show only the username and
 * the privacy-gated avatar, and link to that member's community profile.
 */
export function FollowsSheet({
  mode,
  onClose,
  onRemoved,
}: {
  mode: FollowsMode;
  onClose: () => void;
  /** Called after a row is removed, so the caller can adjust its counts. */
  onRemoved?: (mode: FollowsMode) => void;
}) {
  const { getToken } = useAuth();
  const [users, setUsers] = useState<SocialUser[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // getToken is a fresh identity each render in the test mock; read it through a
  // ref so the mount fetch runs exactly once. Same convention as LikedBySheet.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useScrollLock(true);

  const load = useCallback(
    async (before?: string) => {
      const token = await getTokenRef.current();
      if (!token) return;
      const fetchPage = mode === 'followers' ? fetchMyFollowers : fetchMyFollowing;
      const res = await fetchPage(token, before);
      setUsers((prev) => (before ? [...prev, ...res.users] : res.users));
      setNextBefore(res.nextBefore);
    },
    [mode],
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

  async function act(u: SocialUser) {
    if (mode === 'followers' && !window.confirm(`Remove @${u.username} from your followers?`)) {
      return;
    }
    const token = await getTokenRef.current();
    if (!token) return;
    setBusyId(u.id);
    try {
      if (mode === 'followers') await removeFollower(token, u.id);
      else await unfollowUser(token, u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      onRemoved?.(mode);
    } catch {
      window.alert(
        mode === 'followers'
          ? 'Could not remove that follower. Please try again.'
          : 'Could not unfollow. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  const title = mode === 'followers' ? 'Followers' : 'Following';
  const empty =
    mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.';
  const actionLabel = mode === 'followers' ? 'Remove' : 'Unfollow';

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
        aria-label={title}
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
            {title}
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
              Could not load the list.
            </p>
          ) : users.length === 0 ? (
            <p
              className="px-3 py-6 text-center text-[13px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {empty}
            </p>
          ) : (
            <>
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 px-2 py-2 rounded-[6px]"
                >
                  <Link
                    href={`/community/u/${encodeURIComponent(u.username)}`}
                    onClick={onClose}
                    className="gg-press flex items-center gap-3 flex-1 min-w-0"
                  >
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0"
                      style={{
                        background: 'var(--bg-inset)',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                      }}
                    >
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatarUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (u.username?.[0] ?? '?').toUpperCase()
                      )}
                    </span>
                    <span
                      className="text-[14px] truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {u.username}
                    </span>
                    <VerificationBadges verification={u.verification} />
                    {u.isVerifiedExpert && (
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
                  <button
                    type="button"
                    onClick={() => act(u)}
                    disabled={busyId === u.id}
                    className="gg-press text-[12px] font-medium px-3 py-1.5 rounded-[6px] shrink-0"
                    style={{
                      background: 'var(--bg-card)',
                      color: 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                    }}
                  >
                    {busyId === u.id ? '…' : actionLabel}
                  </button>
                </div>
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
