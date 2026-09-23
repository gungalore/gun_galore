'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  type FeedPost,
  type MySummary,
  deletePost,
  fetchMyPosts,
  fetchMySummary,
} from '../../lib/community-api';
import { postTypeLabel } from '../../lib/post-types';
import { PostComposer } from './post-composer';

// Compact status pill shared by the rail and the full control centre.
export function postStatusMeta(post: FeedPost): {
  label: string;
  fg: string;
  bg: string;
} {
  switch (post.moderationState) {
    case 'PROCESSING':
      return { label: 'Processing', fg: 'var(--text-secondary)', bg: 'var(--bg-inset)' };
    case 'IN_REVIEW':
      return { label: 'In review', fg: 'var(--text-secondary)', bg: 'var(--bg-inset)' };
    case 'BLOCKED':
      return { label: 'Blocked', fg: 'var(--red)', bg: 'var(--red-wash)' };
    default:
      return { label: 'Live', fg: 'var(--text-secondary)', bg: 'var(--bg-inset)' };
  }
}

function thumbOf(post: FeedPost): string | null {
  return post.images[0]?.url ?? post.video?.thumbnailUrl ?? null;
}

/**
 * The member's "little control panel" — the right rail on /community and the
 * homepage Community tab. It is a SUMMARY: a red Create Post button, the
 * member's picture + name, numbers, the latest few posts with inline delete,
 * and quick links. Editing and the full list live on /community/me.
 *
 * ⚠️ The composer lives HERE, not in the feed (operator, 2026-09-22). Creating
 * a post dispatches `gg:feed-refresh` so the sibling FeedClient reloads.
 */
export function MyControlPanel() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [summary, setSummary] = useState<MySummary | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const [s, p] = await Promise.all([
        fetchMySummary(token),
        fetchMyPosts(token, { limit: 5 }),
      ]);
      setSummary(s);
      setPosts(p.posts);
    } catch {
      /* leave the panel empty rather than shout */
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function onDelete(post: FeedPost) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    const token = await getToken();
    if (!token) return;
    setBusyId(post.id);
    try {
      await deletePost(token, post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      void load();
    } catch {
      window.alert('Could not delete the post. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const stat = (value: number | undefined, label: string) => (
    <div className="flex flex-col items-center">
      <span
        className="text-[16px] font-medium"
        style={{ color: 'var(--text-primary)' }}
      >
        {value ?? '—'}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
    </div>
  );

  const initial = (summary?.username?.[0] ?? '?').toUpperCase();

  return (
    <>
      <section
        aria-label="My menu"
        className="gg-tile rounded-lg p-4 flex flex-col gap-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        {/* Red Create Post button where the "My community" heading used to be. */}
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="gg-press w-full rounded-pill py-2.5 text-[13px] font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
        >
          Create Post
        </button>

        {/* Identity — the member's profile picture is shown by default. */}
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-medium shrink-0"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
            }}
          >
            {summary?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={summary.avatarUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="text-[14px] font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {summary?.username ?? 'You'}
            </div>
          </div>
          <Link
            href="/community/me"
            className="gg-press text-[12px] shrink-0"
            style={{ color: 'var(--red)' }}
          >
            Manage
          </Link>
        </div>

        <div className="grid grid-cols-4">
          {stat(summary?.postCount, 'Posts')}
          {stat(summary?.commentCount, 'Comments')}
          {stat(summary?.followerCount, 'Followers')}
          {stat(summary?.followingCount, 'Following')}
        </div>

        <div
          className="flex flex-col gap-1 pt-2 text-[13px]"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <Link
            href="/community/settings"
            className="gg-press py-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Feed filters
          </Link>
          <Link
            href="/community/settings"
            className="gg-press py-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            Muted content
          </Link>
        </div>
      </section>

      {/* Create Post modal — reuses the one composer, in controlled mode. */}
      {composerOpen &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create post"
            onClick={() => setComposerOpen(false)}
            className="fixed inset-0 z-[1000] flex items-start justify-center p-4 overflow-y-auto"
            style={{ background: 'rgba(0,0,0,0.55)' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl my-8"
            >
              <PostComposer
                open
                onOpenChange={(v) => {
                  if (!v) setComposerOpen(false);
                }}
                onPosted={() => {
                  setComposerOpen(false);
                  void load();
                  window.dispatchEvent(new Event('gg:feed-refresh'));
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
