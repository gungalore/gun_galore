'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  type FeedComment,
  type FeedPost,
  dislikePost,
  fetchPost,
  likePost,
  undislikePost,
  unlikePost,
} from '../../lib/community-api';
import { postTypeLabel } from '../../lib/post-types';
import { CommentThread } from './comment-thread';
import { VerificationBadges } from '../verification-badges';
import { useScrollLock } from '../../lib/use-scroll-lock';

/**
 * The Facebook-style post overlay. Two modes share one component:
 *
 * - `photoIndex == null` — a centred post card with its comment thread.
 * - `photoIndex != null` — a fullscreen photo stage with the post's sidebar
 *   (author, action bar, comments) on the right.
 *
 * Opened from the feed's Comment button or any photo tile. It fetches the post
 * + comments itself so it works the same from every surface.
 */
export function PostModal({
  postId,
  photoIndex = null,
  onClose,
  onChanged,
}: {
  postId: string;
  photoIndex?: number | null;
  onClose: () => void;
  /** Notify the caller that a count may have changed. */
  onChanged?: () => void;
}) {
  const { getToken } = useAuth();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(photoIndex ?? 0);
  const photoMode = photoIndex !== null;
  const ZOOM_SCALE = 2;
  const [zoomed, setZoomed] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
  });

  useScrollLock(true);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoomed(false);
  }, [idx]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const data = await fetchPost(token, postId);
      setPost(data.post);
      setComments(data.comments);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (photoMode && post && post.images.length > 1) {
        if (e.key === 'ArrowLeft') {
          setIdx((i) => (i - 1 + post.images.length) % post.images.length);
        } else if (e.key === 'ArrowRight') {
          setIdx((i) => (i + 1) % post.images.length);
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, photoMode, post]);

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
      onChanged?.();
    } catch {
      await load();
    }
  }

  const image = post?.images[idx];

  function body(compact = false) {
    if (!post) return null;
    return (
      <div className={compact ? 'px-4 py-3' : 'px-4 py-3'}>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[14px] font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {post.author.username}
          </span>
          <VerificationBadges verification={post.author.verification} />
          <span
            className="text-[12px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            {postTypeLabel(post.type)}
          </span>
          {post.isOfficial && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: 'var(--red-wash)', color: 'var(--red)' }}
            >
              Official
            </span>
          )}
        </div>
        {post.title && (
          <h2
            className="text-[15px] font-medium mt-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {post.title}
          </h2>
        )}
        {post.body && (
          <p
            className="text-[13px] leading-relaxed whitespace-pre-wrap mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {post.body}
          </p>
        )}
      </div>
    );
  }

  function actionBar() {
    if (!post) return null;
    return (
      <div
        className="flex items-center gap-1 px-3 py-2 flex-wrap"
        style={{ borderTop: '0.5px solid var(--border)' }}
      >
        <button
          type="button"
          onClick={() => void react('like')}
          className="gg-press flex items-center gap-1.5 px-2.5 py-2 rounded text-[13px] font-medium"
          style={{ color: post.liked ? 'var(--red)' : 'var(--text-tertiary)' }}
          aria-pressed={post.liked}
          aria-label={post.liked ? 'Remove like' : 'Like'}
        >
          👍 Like
        </button>
        <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          {post.likeCount}
        </span>
        <button
          type="button"
          onClick={() => void react('dislike')}
          className="gg-press flex items-center gap-1.5 px-2.5 py-2 rounded text-[13px] font-medium"
          style={{ color: post.disliked ? 'var(--red)' : 'var(--text-tertiary)' }}
          aria-pressed={post.disliked}
          aria-label={post.disliked ? 'Remove dislike' : 'Dislike'}
        >
          👎 Dislike
        </button>
        <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          {post.dislikeCount}
        </span>
        <span className="flex-1" />
        <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          💬 {post.commentCount}
        </span>
      </div>
    );
  }

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close post"
      className="absolute z-20 flex items-center justify-center rounded-full"
      style={{
        top: 16,
        right: 16,
        width: 36,
        height: 36,
        background: 'rgba(255,255,255,0.12)',
        border: '0.5px solid rgba(255,255,255,0.2)',
        color: '#fff',
        fontSize: 16,
      }}
    >
      ✕
    </button>
  );

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}
      >
        <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (failed || !post) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}
      >
        <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
          This post is not available.
        </p>
      </div>
    );
  }

  if (photoMode) {
    return (
      <div
        className="fixed inset-0 z-[1000] flex flex-col md:flex-row"
        style={{ background: 'rgba(0,0,0,0.94)' }}
        role="dialog"
        aria-modal="true"
        aria-label={`${post.title ?? 'Post'} — photo viewer`}
      >
        {closeButton}
        <div className="relative flex-1 min-h-0 flex items-center justify-center">
          {post.images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setIdx((i) => (i - 1 + post.images.length) % post.images.length)
                }
                aria-label="Previous photo"
                className="absolute left-3 z-10 flex items-center justify-center rounded-full"
                style={{
                  width: 44,
                  height: 44,
                  background: 'rgba(255,255,255,0.12)',
                  border: '0.5px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontSize: 20,
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setIdx((i) => (i + 1) % post.images.length)}
                aria-label="Next photo"
                className="absolute right-3 z-10 flex items-center justify-center rounded-full"
                style={{
                  width: 44,
                  height: 44,
                  background: 'rgba(255,255,255,0.12)',
                  border: '0.5px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  fontSize: 20,
                }}
              >
                ›
              </button>
            </>
          )}
          {image && (
            <div
              ref={wrapperRef}
              onClick={(e) => {
                e.stopPropagation();
                if (dragRef.current.moved) {
                  dragRef.current.moved = false;
                  return;
                }
                setZoomed((z) => !z);
              }}
              onPointerDown={(e) => {
                if (!zoomed) return;
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                dragRef.current = {
                  active: true,
                  startX: e.clientX,
                  startY: e.clientY,
                  startPanX: pan.x,
                  startPanY: pan.y,
                  moved: false,
                };
              }}
              onPointerMove={(e) => {
                if (!dragRef.current.active) return;
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
                const wrapper = wrapperRef.current;
                const img = imgRef.current;
                if (!wrapper || !img) return;
                const wr = wrapper.getBoundingClientRect();
                const overX = Math.max(
                  0,
                  (img.naturalWidth * ZOOM_SCALE - wr.width) / 2,
                );
                const overY = Math.max(
                  0,
                  (img.naturalHeight * ZOOM_SCALE - wr.height) / 2,
                );
                const maxX = Math.max(overX, (wr.width * (ZOOM_SCALE - 1)) / 2);
                const maxY = Math.max(overY, (wr.height * (ZOOM_SCALE - 1)) / 2);
                setPan({
                  x: Math.max(-maxX, Math.min(maxX, dragRef.current.startPanX + dx)),
                  y: Math.max(-maxY, Math.min(maxY, dragRef.current.startPanY + dy)),
                });
              }}
              onPointerUp={() => {
                dragRef.current.active = false;
              }}
              onPointerCancel={() => {
                dragRef.current.active = false;
                dragRef.current.moved = false;
              }}
              style={{
                maxWidth: '92%',
                maxHeight: '92%',
                overflow: 'hidden',
                cursor: zoomed
                  ? dragRef.current.active
                    ? 'grabbing'
                    : 'grab'
                  : 'zoom-in',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: zoomed ? 'none' : 'auto',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={image.url}
                alt={`Photo ${idx + 1} of ${post.images.length}`}
                draggable={false}
                style={{
                  maxWidth: '92vw',
                  maxHeight: '92vh',
                  objectFit: 'contain',
                  transform: zoomed
                    ? `translate(${pan.x}px, ${pan.y}px) scale(${ZOOM_SCALE})`
                    : 'none',
                  transformOrigin: 'center center',
                  transition: dragRef.current.active
                    ? 'none'
                    : 'transform 0.18s ease-out',
                  userSelect: 'none',
                  willChange: 'transform',
                }}
              />
            </div>
          )}
          {!zoomed && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center px-3"
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                pointerEvents: 'none',
              }}
            >
              Click to zoom 2× · drag to pan · ← → to navigate · Esc to close
            </div>
          )}
        </div>

        <aside
          className="w-full md:w-[400px] shrink-0 flex flex-col min-h-0"
          style={{
            background: 'var(--bg-card)',
            borderLeft: '0.5px solid var(--border)',
            maxHeight: '100%',
          }}
        >
          <div
            className="px-4 py-2 shrink-0 text-[11px]"
            style={{
              color: 'var(--text-tertiary)',
              borderBottom: '0.5px solid var(--border)',
            }}
          >
            This photo is from a post.
          </div>
          <div className="flex flex-col min-h-0 flex-1">
            <div className="shrink-0">
              {body()}
              {actionBar()}
            </div>
            <div className="px-4 py-3 flex-1 min-h-0 flex flex-col">
              <CommentThread
                postId={post.id}
                comments={comments}
                onRefresh={load}
                initialSort="relevant"
                pinComposer
              />
            </div>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={post.title ?? 'Post'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] rounded-[10px] overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
            Post
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close post"
            className="gg-press px-2 py-1 rounded text-[15px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto min-h-0 flex-1">
          {body()}
          {post.images.length > 0 && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-1">
              {post.images.slice(0, 4).map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-label={`Open photo ${i + 1}`}
                  style={{ border: 0, padding: 0, background: 'var(--bg-inset)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    style={{
                      width: '100%',
                      height: 160,
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </button>
              ))}
            </div>
          )}
          {actionBar()}
          <div className="px-4 py-3">
            <CommentThread
              postId={post.id}
              comments={comments}
              onRefresh={load}
              initialSort="relevant"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
