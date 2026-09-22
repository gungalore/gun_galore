'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '../../lib/auth';
import {
  CommunityApiError,
  type FeedComment,
  type FeedPost,
  addComment,
  fetchConfig,
  fetchPost,
  likePost,
  reportComment,
  reportPost,
  unlikePost,
} from '../../lib/community-api';
import { PostCard } from './post-card';

export function PostDetailClient({ id }: { id: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [forceBlur, setForceBlur] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  async function toggleLike(p: FeedPost) {
    const token = await getToken();
    if (!token || !post) return;
    const wasLiked = p.liked;
    setPost({
      ...post,
      liked: !wasLiked,
      likeCount: post.likeCount + (wasLiked ? -1 : 1),
    });
    try {
      if (wasLiked) await unlikePost(token, p.id);
      else await likePost(token, p.id);
    } catch {
      setPost({ ...post, liked: wasLiked, likeCount: post.likeCount });
    }
  }

  async function submitComment() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await addComment(token, id, text);
      if (res.moderation.decision === 'PUBLISHED') {
        setDraft('');
        await load();
      } else {
        setDraft('');
        await load();
      }
    } catch {
      /* leave the draft in place */
    } finally {
      setBusy(false);
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

  async function reportCommentAction(commentId: string) {
    if (!window.confirm('Report this comment to the moderators?')) return;
    const token = await getToken();
    if (!token) return;
    try {
      await reportComment(token, commentId, 'other');
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

  const topLevel = comments.filter((c) => !c.parentId);
  const repliesFor = (parentId: string) =>
    comments.filter((c) => c.parentId === parentId);

  return (
    <div className="flex flex-col gap-4">
      <PostCard
        post={post}
        forceBlur={forceBlur}
        onToggleLike={toggleLike}
        onHideType={() => undefined}
        onMuteAuthor={() => undefined}
        onMuteTag={() => undefined}
        onReport={reportPostAction}
      />

      <div
        className="gg-tile rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <h2
          className="text-[14px] font-medium mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          Comments ({post.commentCount})
        </h2>

        <div className="flex flex-col gap-3 mb-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Add a comment…"
            className="w-full px-3 py-2 rounded-[6px] text-[14px] resize-y"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={submitComment}
            disabled={busy || !draft.trim()}
            className="gg-press self-end px-4 py-2 rounded-[6px] text-[13px] font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              opacity: busy || !draft.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Posting…' : 'Comment'}
          </button>
        </div>

        {topLevel.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            No comments yet.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {topLevel.map((c) => (
            <div key={c.id}>
              <CommentRow comment={c} onReport={reportCommentAction} />
              <div className="ml-8 mt-2 flex flex-col gap-2">
                {repliesFor(c.id).map((r) => (
                  <CommentRow key={r.id} comment={r} onReport={reportCommentAction} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  onReport,
}: {
  comment: FeedComment;
  onReport?: (id: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
      >
        {(comment.author.username?.[0] ?? '?').toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {comment.author.username}
          </span>
          {onReport && (
            <button
              type="button"
              onClick={() => onReport(comment.id)}
              className="gg-press text-[11px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Report
            </button>
          )}
        </div>
        <p
          className="text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--text-secondary)' }}
        >
          {comment.body}
        </p>
      </div>
    </div>
  );
}
