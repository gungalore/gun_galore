'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  type FeedPost,
  fetchConfig,
  fetchGroup,
  joinGroup,
  leaveGroup,
  likePost,
  unlikePost,
} from '../../lib/community-api';
import { PostCard } from './post-card';

interface GroupInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
}

export function GroupClient({ slug }: { slug: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceBlur, setForceBlur] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const cfg = await fetchConfig(token).catch(() => null);
      if (cfg) setForceBlur(cfg.graphicBlurForced);
      const res = await fetchGroup(token, slug);
      setGroup(res.group);
      setPosts(res.posts);
      setNextBefore(res.nextBefore);
    } finally {
      setLoading(false);
    }
  }, [getToken, slug]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function toggleJoin() {
    if (!group) return;
    const token = await getToken();
    if (!token) return;
    const next = !group.joined;
    setGroup({
      ...group,
      joined: next,
      memberCount: group.memberCount + (next ? 1 : -1),
    });
    try {
      if (next) await joinGroup(token, group.id);
      else await leaveGroup(token, group.id);
    } catch {
      await load();
    }
  }

  async function toggleLike(post: FeedPost) {
    const token = await getToken();
    if (!token) return;
    const wasLiked = post.liked;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked: !wasLiked, likeCount: p.likeCount + (wasLiked ? -1 : 1) }
          : p,
      ),
    );
    try {
      if (wasLiked) await unlikePost(token, post.id);
      else await likePost(token, post.id);
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, liked: wasLiked, likeCount: post.likeCount } : p,
        ),
      );
    }
  }

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetchGroup(token, slug, { before: nextBefore });
      setPosts((prev) => [...prev, ...res.posts]);
      setNextBefore(res.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading || !group) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="gg-tile rounded-[8px] p-4 flex items-start gap-3"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {group.name}
          </h1>
          {group.description && (
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {group.description}
            </p>
          )}
          <div className="text-[12px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {group.memberCount} members
          </div>
        </div>
        <button
          type="button"
          onClick={toggleJoin}
          className="gg-press px-4 py-2 rounded-[6px] text-[13px] font-medium shrink-0"
          style={{
            background: group.joined ? 'var(--bg-card)' : 'var(--red)',
            color: group.joined ? 'var(--text-secondary)' : '#fff',
            border: group.joined ? '0.5px solid var(--border)' : 'none',
          }}
        >
          {group.joined ? 'Joined' : 'Join'}
        </button>
      </div>

      {posts.length === 0 && (
        <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
          No posts in this group yet.
        </p>
      )}
      <div className="flex flex-col gap-4">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            forceBlur={forceBlur}
            onToggleLike={toggleLike}
            onHideType={() => undefined}
            onMuteAuthor={() => undefined}
            onMuteTag={() => undefined}
          />
        ))}
      </div>
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
    </div>
  );
}
