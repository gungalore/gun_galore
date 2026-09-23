'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  type FeedPost,
  type MySummary,
  deletePost,
  fetchMyPosts,
  fetchMySummary,
  updatePost,
} from '../../lib/community-api';
import { postTypeLabel } from '../../lib/post-types';
import { postStatusMeta } from './my-control-panel';
import { ChipRail, type Chip } from '../ui/ChipRail';

type Tab = 'all' | 'live' | 'processing' | 'blocked';

const POST_TABS: Chip[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'processing', label: 'Processing' },
  { value: 'blocked', label: 'Blocked' },
];

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA');
}

function thumbOf(post: FeedPost): string | null {
  return post.images[0]?.url ?? post.video?.thumbnailUrl ?? null;
}

function inTab(post: FeedPost, tab: Tab): boolean {
  const state = post.moderationState ?? 'PUBLISHED';
  if (tab === 'all') return true;
  if (tab === 'live') return state === 'PUBLISHED';
  if (tab === 'processing') return state === 'PROCESSING' || state === 'IN_REVIEW';
  return state === 'BLOCKED';
}

/**
 * The full "My community" control centre at /community/me. Every post the
 * member authored, whatever its status, with edit + delete. Editing text
 * re-queues the post for background moderation, so the row drops back to
 * "Processing" while it is re-checked.
 */
export function MyPostsClient() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  // Pull the primitive out so the load effect depends on a string, not on the
  // searchParams object identity (which would re-fire the effect every render).
  const editId = searchParams.get('edit');
  const autoOpenedEdit = useRef<string | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [summary, setSummary] = useState<MySummary | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit modal state.
  const [editing, setEditing] = useState<FeedPost | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTags, setEditTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadFirst = useCallback(
    async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const [page, sum] = await Promise.all([
          fetchMyPosts(token, { limit: 20 }),
          fetchMySummary(token),
        ]);
        setPosts(page.posts);
        setNextBefore(page.nextBefore);
        setSummary(sum);
        setError(null);
        // Deep link from the ⋯ menu: /community/me?edit=<id>. Open it ONCE —
        // otherwise a save (which reloads) would immediately reopen the modal.
        if (editId && autoOpenedEdit.current !== editId) {
          const target = page.posts.find((p) => p.id === editId);
          if (target) {
            autoOpenedEdit.current = editId;
            openEditor(target);
          }
        }
      } catch {
        setError('Could not load your posts. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    // openEditor is a hoisted declaration that only touches state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getToken, editId],
  );

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  // Re-poll while anything the member owns is still being checked.
  useEffect(() => {
    const pending = posts.some(
      (p) =>
        p.moderationState === 'PROCESSING' || p.moderationState === 'IN_REVIEW',
    );
    if (!pending) return;
    const id = setInterval(() => void loadFirst(), 8000);
    return () => clearInterval(id);
  }, [posts, loadFirst]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const page = await fetchMyPosts(token, { before: nextBefore });
      setPosts((prev) => [...prev, ...page.posts]);
      setNextBefore(page.nextBefore);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  function openEditor(post: FeedPost) {
    setEditing(post);
    setEditTitle(post.title ?? '');
    setEditBody(post.body);
    setEditTags(post.tags.join(', '));
    setSaveError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const tags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const { post } = await updatePost(token, editing.id, {
        title: editTitle,
        body: editBody,
        tags,
      });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
      setEditing(null);
      void loadFirst();
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? 'Could not save — check your wording and try again.'
          : 'Could not save. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(post: FeedPost) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    const token = await getToken();
    if (!token) return;
    setBusyId(post.id);
    try {
      await deletePost(token, post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      void fetchMySummary(token).then(setSummary).catch(() => undefined);
    } catch {
      window.alert('Could not delete the post. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => posts.filter((p) => inTab(p, tab)), [posts, tab]);

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div
          className="grid grid-cols-4 rounded-[8px] p-3 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          {[
            ['Posts', summary.postCount],
            ['Comments', summary.commentCount],
            ['Followers', summary.followerCount],
            ['Following', summary.followingCount],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col">
              <span
                className="text-[17px] font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {value as number}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {label as string}
              </span>
            </div>
          ))}
        </div>
      )}

      <ChipRail
        items={POST_TABS}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        label="Post status"
        size="sm"
      />

      {loading && (
        <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      )}
      {error && (
        <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
          {error}
        </p>
      )}
      {!loading && !error && shown.length === 0 && (
        <p
          className="text-center text-[14px] py-8"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {tab === 'all'
            ? "You haven't posted yet."
            : 'Nothing in this tab.'}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {shown.map((post) => {
          const status = postStatusMeta(post);
          const thumb = thumbOf(post);
          return (
            <li
              key={post.id}
              className="gg-tile rounded-[8px] p-3 flex gap-3"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              <Link
                href={`/community/p/${post.id}`}
                className="w-16 h-16 rounded-[6px] shrink-0 overflow-hidden"
                style={{ background: 'var(--bg-inset)' }}
                aria-label={post.title ?? postTypeLabel(post.type)}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                ) : null}
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{ background: status.bg, color: status.fg }}
                  >
                    {status.label}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {postTypeLabel(post.type)} · {timeAgo(post.createdAt)}
                    {post.editedAt ? ' · edited' : ''}
                  </span>
                </div>
                <div
                  className="text-[14px] font-medium mt-1 truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {post.title ?? post.body}
                </div>
                {post.title && (
                  <div
                    className="text-[12px] truncate"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {post.body}
                  </div>
                )}
                {post.moderationState === 'BLOCKED' && post.moderationReason && (
                  <div className="text-[12px] mt-1" style={{ color: 'var(--red)' }}>
                    {post.moderationReason}
                  </div>
                )}
                <div
                  className="text-[11px] mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {post.likeCount} likes · {post.commentCount} comments
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openEditor(post)}
                  className="gg-press text-[12px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(post)}
                  disabled={busyId === post.id}
                  className="gg-press text-[12px]"
                  style={{ color: 'var(--red)' }}
                >
                  {busyId === post.id ? '…' : 'Delete'}
                </button>
                <Link
                  href={`/community/p/${post.id}`}
                  className="gg-press text-[12px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  View
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {nextBefore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="gg-press mx-auto px-5 py-2.5 rounded-[6px] text-[13px]"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit post"
          onClick={() => !saving && setEditing(null)}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-[8px] p-4 flex flex-col gap-3"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
          >
            <h2
              className="text-[15px] font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Edit post
            </h2>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full px-3 py-2 rounded-[6px] text-[13px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
              }}
            />
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 rounded-[6px] text-[13px] resize-y"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
              }}
            />
            <input
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="Tags, comma separated"
              className="w-full px-3 py-2 rounded-[6px] text-[13px]"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
              }}
            />
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Edited posts are re-checked before they go live again.
            </p>
            {saveError && (
              <p className="text-[12px]" style={{ color: 'var(--red)' }}>
                {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className="gg-press px-4 py-2 rounded-[6px] text-[13px]"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving || !editBody.trim()}
                className="gg-press px-4 py-2 rounded-[6px] text-[13px] font-medium"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
