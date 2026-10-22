'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  CommunityApiError,
  type FeedComment,
  type FeedPost,
  dislikePost,
  fetchConfig,
  fetchPost,
  likePost,
  reportPost,
  undislikePost,
  unlikePost,
} from '../../lib/community-api';
import { PostCard } from './post-card';
import { PostModal } from './post-modal';
import { CommentThread } from './comment-thread';

export function PostDetailClient({ id }: { id: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forceBlur, setForceBlur] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const cfg = await fetchConfig(token).catch(() => null);
      if (cfg) setForceBlur(cfg.graphicBlurForced);
      const data = await fetchPost(token, id);
      setPost(data.post);
      setComments(data.comments);
      setNotFound(false);
    } catch (e) {
      if (e instanceof CommunityApiError && e.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, id]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void load();
  }, [isLoaded, isSignedIn, load]);

  async function react(kind: 'like' | 'dislike') {
    if (!post) return;
    const token = await getToken();
    if (!token) return;
    const wasLike = post.liked;
    const wasDislike = post.disliked;
    const active = kind === 'like' ? wasLike : wasDislike;
    setPost({
      ...post,
      liked: active ? false : kind === 'like',
      disliked: active ? false : kind === 'dislike',
      likeCount:
        post.likeCount +
        (kind === 'like' ? (active ? -1 : 1) : wasLike ? -1 : 0),
      dislikeCount:
        post.dislikeCount +
        (kind === 'dislike' ? (active ? -1 : 1) : wasDislike ? -1 : 0),
    });
    try {
      if (active) {
        if (kind === 'like') await unlikePost(token, post.id);
        else await undislikePost(token, post.id);
      } else if (kind === 'like') {
        await likePost(token, post.id);
      } else {
        await dislikePost(token, post.id);
      }
    } catch {
      await load();
    }
  }

  async function reportPostAction() {
    if (!window.confirm('Report this post to the moderators?')) return;
    const token = await getToken();
    if (!token) return;
    try {
      await reportPost(token, id, 'other');
      window.alert('Thanks — the moderators will review it.');
    } catch {
      window.alert('Could not send the report. Please try again.');
    }
  }

  if (notFound) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        This post is not available.
      </p>
    );
  }
  if (loading || !post) {
    return (
      <p className="text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PostCard
        post={post}
        forceBlur={forceBlur}
        onToggleLike={() => void react('like')}
        onToggleDislike={() => void react('dislike')}
        onHideType={() => undefined}
        onMuteAuthor={() => undefined}
        onMuteTag={() => undefined}
        onReport={reportPostAction}
        onOpen={() => {
          setPhotoIndex(null);
          setModalOpen(true);
        }}
        onOpenPhoto={(_, i) => {
          setPhotoIndex(i);
          setModalOpen(true);
        }}
      />

      <div
        className="gg-tile rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <CommentThread
          postId={post.id}
          comments={comments}
          onRefresh={load}
          initialSort="relevant"
        />
      </div>

      {modalOpen && (
        <PostModal
          postId={post.id}
          photoIndex={photoIndex}
          onClose={() => setModalOpen(false)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
