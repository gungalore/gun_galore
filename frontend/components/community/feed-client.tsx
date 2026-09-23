'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '../../lib/auth';
import {
  CommunityApiError,
  type FeedAd,
  type FeedPost,
  type FeedPreferences,
  deletePost,
  fetchConfig,
  fetchFeed,
  fetchPreferences,
  likePost,
  reportPost,
  savePreferences,
  unlikePost,
} from '../../lib/community-api';
import { POST_TYPE_LABELS, POST_TYPE_ORDER } from '../../lib/post-types';
import { AdCard } from './ad-card';
import { PostCard } from './post-card';
import { ChipRail, type Chip } from '../ui/ChipRail';

/** Insert a featured ad after every Nth post. */
const AD_EVERY = 4;

const FEED_FILTERS: Chip[] = [
  { value: '', label: 'All' },
  ...POST_TYPE_ORDER.map((t) => ({ value: t, label: POST_TYPE_LABELS[t] as string })),
];

export function FeedClient() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [includeFiltered, setIncludeFiltered] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [forceBlur, setForceBlur] = useState(false);
  const [sortBy, setSortBy] = useState('latest');
  const [ads, setAds] = useState<FeedAd[]>([]);
  const [prefs, setPrefs] = useState<FeedPreferences>({
    feedMutedPostTypes: [],
    feedMutedAuthorIds: [],
    feedMutedTags: [],
    feedMutedTopicIds: [],
    feedShowAvatar: true,
    feedShowGraphic: true,
  });

  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const cfg = await fetchConfig(token).catch(() => null);
      if (cfg) setForceBlur(cfg.graphicBlurForced);
      const page = await fetchFeed(token, {
        type: filterType || undefined,
        includeFiltered,
      });
      setPosts(page.posts);
      setAds(page.ads ?? []);
      setNextBefore(page.nextBefore);
      setError(null);
      setDisabled(false);
    } catch (e) {
      if (e instanceof CommunityApiError && e.status === 404) {
        setDisabled(true);
      } else {
        setError('Could not load the feed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [getToken, filterType, includeFiltered]);

  const loadPrefs = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const p = await fetchPreferences(token);
      setPrefs(p);
    } catch {
      /* leave defaults */
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    void loadFirst();
    // Load preferences
    void loadPrefs();
  }, [isLoaded, isSignedIn, loadFirst, loadPrefs]);

  // The composer now lives in the "My" panel (Create Post), so tell the feed to
  // refresh when a post is created there — the two are sibling components.
  useEffect(() => {
    function onPosted() {
      void loadFirst();
    }
    window.addEventListener('gg:feed-refresh', onPosted);
    return () => window.removeEventListener('gg:feed-refresh', onPosted);
  }, [loadFirst]);

  // Poll while any of the member's own posts is still being checked, so it
  // flips to "live" on its own — the member was told it will appear automatically.
  useEffect(() => {
    const pending = posts.some(
      (p) =>
        p.moderationState === 'PROCESSING' ||
        p.moderationState === 'IN_REVIEW',
    );
    if (!pending) return;
    const id = setInterval(() => {
      void loadFirst();
    }, 8000);
    return () => clearInterval(id);
  }, [posts, loadFirst]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const page = await fetchFeed(token, {
        before: nextBefore,
        type: filterType || undefined,
        includeFiltered,
      });
      setPosts((prev) => [...prev, ...page.posts]);
      setNextBefore(page.nextBefore);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
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
          p.id === post.id
            ? { ...p, liked: wasLiked, likeCount: post.likeCount }
            : p,
        ),
      );
    }
  }

  async function updatePrefs(
    mutate: (p: FeedPreferences) => FeedPreferences,
  ) {
    const token = await getToken();
    if (!token) return;
    const current = await fetchPreferences(token);
    await savePreferences(token, mutate(current));
    await loadFirst();
  }

  const hideType = (type: string) =>
    void updatePrefs((p) => ({
      ...p,
      feedMutedPostTypes: Array.from(new Set([...p.feedMutedPostTypes, type])),
    }));
  const muteAuthor = (author: FeedPost['author']) =>
    void updatePrefs((p) => ({
      ...p,
      feedMutedAuthorIds: Array.from(
        new Set([...p.feedMutedAuthorIds, author.id]),
      ),
    }));
  const muteTag = (tag: string) =>
    void updatePrefs((p) => ({
      ...p,
      feedMutedTags: Array.from(
        new Set([...p.feedMutedTags, tag.toLowerCase()]),
      ),
    }));

  async function report(post: FeedPost) {
    if (!window.confirm('Report this post to the moderators?')) return;
    const token = await getToken();
    if (!token) return;
    try {
      await reportPost(token, post.id, 'other');
      window.alert('Thanks — the moderators will review it.');
    } catch {
      window.alert('Could not send the report. Please try again.');
    }
  }

  // Owner actions from the ⋯ menu. Edit lives in the control centre; delete is
  // instant here so the member doesn't lose their place in the feed.
  async function deleteOwnPost(post: FeedPost) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    const token = await getToken();
    if (!token) return;
    try {
      await deletePost(token, post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch {
      window.alert('Could not delete the post. Please try again.');
    }
  }

  const feedItems: ReactNode[] = [];
  posts.forEach((post, index) => {
    feedItems.push(
      <PostCard
        key={post.id}
        post={post}
        showMuted={includeFiltered}
        forceBlur={forceBlur}
        showGraphic={prefs.feedShowGraphic}
        onToggleLike={toggleLike}
        onHideType={hideType}
        onMuteAuthor={muteAuthor}
        onMuteTag={muteTag}
        onReport={report}
        onEditPost={(p) => router.push(`/community/me?edit=${p.id}`)}
        onDeletePost={deleteOwnPost}
        onOpen={(p) => router.push(`/community/p/${p.id}`)}
      />,
    );
    const slot = (index + 1) / AD_EVERY;
    if ((index + 1) % AD_EVERY === 0 && slot - 1 < ads.length) {
      const ad = ads[slot - 1];
      feedItems.push(<AdCard key={`ad-${ad.id}`} ad={ad} />);
    }
  });

  if (disabled) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        The community feed is not available right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ChipRail
        items={FEED_FILTERS}
        value={filterType}
        onChange={(v) => setFilterType(typeof v === 'string' ? v : '')}
        label="Community categories"
        size="sm"
      />

      <div className="flex items-center justify-between mt-2">
        <div />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-transparent text-[13px] font-medium cursor-pointer appearance-none pr-6"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%2376746f' stroke-width='1.5'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right center',
          }}
        >
          <option value="latest">Latest ▾</option>
          <option value="most-liked">Most liked</option>
          <option value="most-commented">Most commented</option>
        </select>
      </div>

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
      {!loading && !error && posts.length === 0 && (
        <p
          className="text-center text-[14px] py-8"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Nothing here yet. Be the first to post.
        </p>
      )}

      <div className="flex flex-col gap-4">{feedItems}</div>

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
