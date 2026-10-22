'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  type FeedComment,
  addComment,
  dislikeComment,
  likeComment,
  reportComment,
  undislikeComment,
  unlikeComment,
} from '../../lib/community-api';
import { LikedBySheet } from './liked-by-sheet';
import { VerificationBadges } from '../verification-badges';

type SortMode = 'relevant' | 'newest' | 'oldest';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-ZA');
}

/**
 * A threaded comment list with the Facebook-style action row: Like / Dislike
 * (mutually exclusive), Reply, Share and Report on every comment, plus a sort
 * control and a composer that can be pinned to the bottom of a modal.
 *
 * The parent owns the comments and supplies `onRefresh`; this component keeps
 * a local copy so reactions feel instant, then reconciles with the server.
 */
export function CommentThread({
  postId,
  comments,
  onRefresh,
  initialSort = 'relevant',
  pinComposer = false,
  emptyLabel = 'No comments yet.',
}: {
  postId: string;
  comments: FeedComment[];
  onRefresh: () => void | Promise<void>;
  initialSort?: SortMode;
  pinComposer?: boolean;
  emptyLabel?: string;
}) {
  const { getToken } = useAuth();
  const [local, setLocal] = useState<FeedComment[]>(comments);
  const [sort, setSort] = useState<SortMode>(initialSort);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{
    commentId: string;
    kind: 'like' | 'dislike';
  } | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLocal(comments);
  }, [comments]);

  useEffect(() => {
    if (replyTo) replyRef.current?.focus();
  }, [replyTo]);

  const byId = useMemo(() => new Map(local.map((c) => [c.id, c])), [local]);

  /** Walk up to the top-level comment so replies never nest deeper than one. */
  const rootId = useCallback(
    (comment: FeedComment): string => {
      let current = comment;
      while (current.parentId) {
        const parent = byId.get(current.parentId);
        if (!parent) return current.parentId;
        current = parent;
      }
      return current.id;
    },
    [byId],
  );

  const topLevel = useMemo(() => {
    const roots = local.filter((c) => !c.parentId || !byId.has(c.parentId));
    const sorted = [...roots];
    if (sort === 'newest') {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sort === 'oldest') {
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } else {
      sorted.sort((a, b) => {
        const score =
          b.likeCount - b.dislikeCount - (a.likeCount - a.dislikeCount);
        return score || b.createdAt.localeCompare(a.createdAt);
      });
    }
    return sorted;
  }, [local, byId, sort]);

  const repliesFor = useCallback(
    (parentId: string) =>
      local
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [local],
  );

  async function react(comment: FeedComment, kind: 'like' | 'dislike') {
    const token = await getToken();
    if (!token) return;
    const active = kind === 'like' ? comment.liked : comment.disliked;
    const snapshot = local;
    // Optimistic: clear the opposite reaction and flip this one.
    setLocal((prev) =>
      prev.map((c) => {
        if (c.id !== comment.id) return c;
        const next = { ...c };
        const prevLike = c.liked;
        const prevDislike = c.disliked;
        if (active) {
          next.liked = false;
          next.disliked = false;
          if (kind === 'like') next.likeCount = Math.max(0, c.likeCount - 1);
          else next.dislikeCount = Math.max(0, c.dislikeCount - 1);
        } else {
          next.liked = kind === 'like';
          next.disliked = kind === 'dislike';
          if (kind === 'like') {
            next.likeCount = c.likeCount + 1;
            if (prevDislike) next.dislikeCount = Math.max(0, c.dislikeCount - 1);
          } else {
            next.dislikeCount = c.dislikeCount + 1;
            if (prevLike) next.likeCount = Math.max(0, c.likeCount - 1);
          }
        }
        return next;
      }),
    );
    try {
      if (active) {
        if (kind === 'like') await unlikeComment(token, comment.id);
        else await undislikeComment(token, comment.id);
      } else if (kind === 'like') {
        await likeComment(token, comment.id);
      } else {
        await dislikeComment(token, comment.id);
      }
      await onRefresh();
    } catch {
      setLocal(snapshot);
    }
  }

  async function submit(parent: FeedComment | null) {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      await addComment(
        token,
        postId,
        text,
        parent ? rootId(parent) : undefined,
      );
      setDraft('');
      setReplyTo(null);
      await onRefresh();
    } catch {
      /* leave the draft so the member can retry */
    } finally {
      setBusy(false);
    }
  }

  async function report(commentId: string) {
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

  function startReply(comment: FeedComment) {
    setReplyTo(comment);
    setDraft((current) =>
      current.trim()
        ? current
        : `@${comment.author.username} `,
    );
  }

  const composer = (
    <div
      className={pinComposer ? 'shrink-0 px-3 py-3' : 'mt-4'}
      style={
        pinComposer
          ? {
              background: 'var(--bg-card)',
              borderTop: '0.5px solid var(--border)',
            }
          : undefined
      }
    >
      {replyTo && (
        <div
          className="flex items-center justify-between px-2 py-1 mb-1 rounded text-[11px]"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
        >
          <span>Replying to {replyTo.author.username}</span>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="Cancel reply"
            className="gg-press px-1"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={replyRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={
            replyTo ? `Reply to ${replyTo.author.username}…` : 'Write a public comment…'
          }
          aria-label="Write a comment"
          className="w-full px-3 py-2 rounded-[10px] text-[13px] resize-y"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="button"
          onClick={() => void submit(replyTo)}
          disabled={busy || !draft.trim()}
          aria-label={replyTo ? 'Send reply' : 'Post comment'}
          className="gg-press px-4 py-2 rounded-[6px] text-[13px] font-medium shrink-0"
          style={{
            background: 'var(--red)',
            color: '#fff',
            opacity: busy || !draft.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2
          className="text-[14px] font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          Comments ({local.length})
        </h2>
        <label className="flex items-center gap-1 text-[12px]">
          <span className="sr-only">Sort comments</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label="Sort comments"
            className="bg-transparent text-[12px] font-medium cursor-pointer appearance-none pr-5"
            style={{
              color: 'var(--text-secondary)',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%2376746f' stroke-width='1.5'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right center',
            }}
          >
            <option value="relevant">Most relevant ▾</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto min-h-0">
        {topLevel.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            {emptyLabel}
          </p>
        )}
        {topLevel.map((c) => (
          <div key={c.id}>
            <CommentRow
              comment={c}
              onReact={react}
              onReply={startReply}
              onReport={report}
              onOpenReactions={(kind) => setSheet({ commentId: c.id, kind })}
            />
            {repliesFor(c.id).length > 0 && (
              <div className="ml-9 mt-2 flex flex-col gap-2">
                {repliesFor(c.id).map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    reply
                    onReact={react}
                    onReply={startReply}
                    onReport={report}
                    onOpenReactions={(kind) =>
                      setSheet({ commentId: r.id, kind })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {composer}

      {sheet && (
        <LikedBySheet
          commentId={sheet.commentId}
          kind={sheet.kind}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function CommentRow({
  comment,
  reply,
  onReact,
  onReply,
  onReport,
  onOpenReactions,
}: {
  comment: FeedComment;
  reply?: boolean;
  onReact: (comment: FeedComment, kind: 'like' | 'dislike') => void;
  onReply: (comment: FeedComment) => void;
  onReport: (commentId: string) => void;
  onOpenReactions: (kind: 'like' | 'dislike') => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <div
        className={`${reply ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-[11px]'} rounded-full flex items-center justify-center font-medium shrink-0`}
        style={{
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
          overflow: 'hidden',
        }}
      >
        {comment.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={comment.author.avatarUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          (comment.author.username?.[0] ?? '?').toUpperCase()
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="inline-block max-w-full px-3 py-2 rounded-2xl"
          style={{ background: 'var(--bg-inset)' }}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[12px] font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {comment.author.username}
            </span>
            <VerificationBadges verification={comment.author.verification} />
          </div>
          <p
            className="text-[13px] leading-relaxed whitespace-pre-wrap mt-0.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            {comment.body}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-1 px-1 text-[11px] flex-wrap">
          <span style={{ color: 'var(--text-tertiary)' }}>
            {timeAgo(comment.createdAt)}
          </span>
          <button
            type="button"
            onClick={() => onReact(comment, 'like')}
            className="gg-press font-medium"
            style={{ color: comment.liked ? 'var(--red)' : 'var(--text-tertiary)' }}
            aria-pressed={comment.liked}
            aria-label={comment.liked ? 'Remove like' : 'Like comment'}
          >
            👍 Like
          </button>
          {comment.likeCount > 0 && (
            <button
              type="button"
              onClick={() => onOpenReactions('like')}
              className="gg-press"
              style={{ color: 'var(--text-secondary)' }}
              aria-label={`See who liked this comment (${comment.likeCount})`}
            >
              {comment.likeCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => onReact(comment, 'dislike')}
            className="gg-press font-medium"
            style={{
              color: comment.disliked ? 'var(--red)' : 'var(--text-tertiary)',
            }}
            aria-pressed={comment.disliked}
            aria-label={
              comment.disliked ? 'Remove dislike' : 'Dislike comment'
            }
          >
            👎 Dislike
          </button>
          {comment.dislikeCount > 0 && (
            <button
              type="button"
              onClick={() => onOpenReactions('dislike')}
              className="gg-press"
              style={{ color: 'var(--text-secondary)' }}
              aria-label={`See who disliked this comment (${comment.dislikeCount})`}
            >
              {comment.dislikeCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => onReply(comment)}
            className="gg-press font-medium"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Reply
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Comment options"
              className="gg-press"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute left-0 mt-1 rounded-[6px] py-1 z-10"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  boxShadow: 'var(--elev-2)',
                  minWidth: 160,
                }}
              >
                <button
                  type="button"
                  className="block w-full text-left px-3 py-2 text-[12px] gg-press"
                  style={{ color: 'var(--red)' }}
                  onClick={() => {
                    setMenuOpen(false);
                    onReport(comment.id);
                  }}
                >
                  Report comment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
