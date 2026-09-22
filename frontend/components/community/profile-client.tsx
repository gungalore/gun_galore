'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  type FeedPost,
  fetchConfig,
  fetchProfile,
  followUser,
  likePost,
  unfollowUser,
  unlikePost,
} from '../../lib/community-api';
import { PostCard } from './post-card';

interface ProfileData {
  profile: {
    id: string;
    username: string;
    avatarUrl: string | null;
    sellerTier: string | null;
    isVerifiedExpert: boolean;
    memberSince: string;
  };
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  points: number;
  level: string;
  postCount: number;
  commentCount: number;
  posts: FeedPost[];
}

export function ProfileClient({ username }: { username: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forceBlur, setForceBlur] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const cfg = await fetchConfig(token).catch(() => null);
      if (cfg) setForceBlur(cfg.graphicBlurForced);
      setData(await fetchProfile(token, username));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [getToken, username]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function toggleFollow() {
    if (!data) return;
    const token = await getToken();
    if (!token) return;
    const next = !data.isFollowing;
    setData({
      ...data,
      isFollowing: next,
      followerCount: data.followerCount + (next ? 1 : -1),
    });
    try {
      if (next) await followUser(token, data.profile.id);
      else await unfollowUser(token, data.profile.id);
    } catch {
      await load();
    }
  }

  async function toggleLike(post: FeedPost) {
    if (!data) return;
    const token = await getToken();
    if (!token) return;
    const wasLiked = post.liked;
    setData({
      ...data,
      posts: data.posts.map((p) =>
        p.id === post.id
          ? { ...p, liked: !wasLiked, likeCount: p.likeCount + (wasLiked ? -1 : 1) }
          : p,
      ),
    });
    try {
      if (wasLiked) await unlikePost(token, post.id);
      else await likePost(token, post.id);
    } catch {
      /* ignore */
    }
  }

  if (loading || !data) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        className="gg-tile rounded-[8px] p-5 flex items-center gap-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-[20px] font-medium shrink-0"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
          }}
        >
          {data.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.profile.avatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            (data.profile.username?.[0] ?? '?').toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[17px] font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {data.profile.username}
            </span>
            {data.profile.isVerifiedExpert && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'var(--gold-wash)', color: 'var(--gold-strong)' }}
              >
                Verified expert
              </span>
            )}
          </div>
          <div
            className="text-[13px] mt-0.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {data.postCount} posts · {data.followerCount} followers
          </div>
        </div>
        <button
          type="button"
          onClick={toggleFollow}
          className="gg-press px-4 py-2 rounded-[6px] text-[13px] font-medium"
          style={{
            background: data.isFollowing ? 'var(--bg-card)' : 'var(--red)',
            color: data.isFollowing ? 'var(--text-secondary)' : '#fff',
            border: data.isFollowing ? '0.5px solid var(--border)' : 'none',
          }}
        >
          {data.isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>

      {data.posts.length === 0 && (
        <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
          No posts yet.
        </p>
      )}
      <div className="flex flex-col gap-4">
        {data.posts.map((post) => (
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
    </div>
  );
}
