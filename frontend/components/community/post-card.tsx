'use client';

import { useState, type CSSProperties } from 'react';
import { useAuth } from '../../lib/auth';
import { type FeedPost, disputePost } from '../../lib/community-api';
import { postTypeLabel } from '../../lib/post-types';
import { ImageLightbox } from '../image-lightbox';

interface PostCardProps {
  post: FeedPost;
  onToggleLike: (post: FeedPost) => void;
  onHideType: (type: string, label: string) => void;
  onMuteAuthor: (author: FeedPost['author']) => void;
  onMuteTag: (tag: string) => void;
  onOpen?: (post: FeedPost) => void;
  onReport?: (post: FeedPost) => void;
  /** Shown on the member's OWN posts (the ⋯ menu). */
  onEditPost?: (post: FeedPost) => void;
  onDeletePost?: (post: FeedPost) => void;
  showMuted?: boolean;
  /** Operator policy: keep graphic content hidden, no tap-to-reveal. */
  forceBlur?: boolean;
}

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

export function PostCard({
  post,
  onToggleLike,
  onHideType,
  onMuteAuthor,
  onMuteTag,
  onOpen,
  onReport,
  onEditPost,
  onDeletePost,
  showMuted,
  forceBlur,
}: PostCardProps) {
  const [revealed, setRevealed] = useState(post.graphicTier === 'NONE');
  const [menuOpen, setMenuOpen] = useState(false);
  const { getToken, userId } = useAuth();
  const [disputeNote, setDisputeNote] = useState('');
  const [disputeMsg, setDisputeMsg] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  // The ⋯ menu carries owner actions only on your own post; everyone else sees
  // the mute/report options.
  const isOwn = !!userId && userId === post.author.id;

  async function submitDispute() {
    const token = await getToken();
    if (!token) return;
    setDisputing(true);
    try {
      const res = await disputePost(token, post.id, disputeNote);
      setDisputeMsg(res.message);
    } catch {
      setDisputeMsg('Could not send the dispute. Please try again.');
    } finally {
      setDisputing(false);
    }
  }

  const graphic = post.graphicTier !== 'NONE';
  // Only EXTREME content is force-hidden. FIELD (normal hunting/fishing field
  // photos) is blurred with a tap-to-reveal, per the tiered policy — forceBlur
  // must not make an ordinary field photo permanently invisible.
  const hiddenForever =
    graphic && post.graphicTier === 'EXTREME' && !!forceBlur;

  // The content-warning badge. Big and red on purpose — members kept tapping
  // past a small, low-contrast hint.
  const overlayBoxStyle: CSSProperties = {
    background: 'color-mix(in srgb, var(--red) 60%, transparent)',
    borderRadius: 16,
    padding: '20px 28px',
    color: '#fff',
    maxWidth: '92%',
    textAlign: 'center',
  };

  async function share() {
    const url = `${window.location.origin}/community/p/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title ?? 'A post', url });
        return;
      }
    } catch {
      /* user cancelled — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <article
      className="gg-tile gg-tile-lift rounded-[8px] overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-medium shrink-0"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
          }}
        >
          {post.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.author.avatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            (post.author.username?.[0] ?? '?').toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[14px] font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {post.author.username}
            </span>
            {post.isOfficial && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'var(--red-wash)', color: 'var(--red)' }}
              >
                Official
              </span>
            )}
            <span
              className="text-[12px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              · {timeAgo(post.createdAt)}
            </span>
          </div>
          <div
            className="text-[12px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {postTypeLabel(post.type)}
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Post options"
            onClick={() => setMenuOpen((v) => !v)}
            className="gg-press px-2 py-1 rounded"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 mt-1 rounded-[6px] py-1 z-10 text-left"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                minWidth: 200,
                boxShadow: 'var(--elev-2)',
              }}
            >
              {isOwn && (onEditPost || onDeletePost) && (
                <>
                  {onEditPost && (
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                      style={{ color: 'var(--text-secondary)' }}
                      onClick={() => {
                        setMenuOpen(false);
                        onEditPost(post);
                      }}
                    >
                      Edit post
                    </button>
                  )}
                  {onDeletePost && (
                    <button
                      type="button"
                      className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                      style={{ color: 'var(--red)' }}
                      onClick={() => {
                        setMenuOpen(false);
                        onDeletePost(post);
                      }}
                    >
                      Delete post
                    </button>
                  )}
                  <div
                    style={{
                      borderTop: '0.5px solid var(--border)',
                      margin: '4px 0',
                    }}
                  />
                </>
              )}
              <button
                type="button"
                className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => {
                  setMenuOpen(false);
                  onHideType(post.type, postTypeLabel(post.type));
                }}
              >
                Hide {postTypeLabel(post.type)} posts
              </button>
              <button
                type="button"
                className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => {
                  setMenuOpen(false);
                  onMuteAuthor(post.author);
                }}
              >
                Mute {post.author.username}
              </button>
              {post.tags.slice(0, 3).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setMenuOpen(false);
                    onMuteTag(t);
                  }}
                >
                  Mute #{t}
                </button>
              ))}
              {onReport && (
                <button
                  type="button"
                  className="block w-full text-left px-3 py-2 text-[13px] gg-press"
                  style={{ color: 'var(--red)' }}
                  onClick={() => {
                    setMenuOpen(false);
                    onReport(post);
                  }}
                >
                  Report post
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {showMuted && post.muted && (
        <div
          className="mx-4 mt-3 px-3 py-2 rounded-[6px] text-[12px]"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
        >
          Shown because you turned off filters — you muted this content.
        </div>
      )}

      {post.moderationState && post.moderationState !== 'PUBLISHED' && (
        <div
          className="mx-4 mt-3 px-3 py-2 rounded-[6px] text-[12px]"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          {post.moderationState === 'PROCESSING' && (
            <span>
              Processing — this will appear on your feed automatically once it
              has been checked.
            </span>
          )}
          {post.moderationState === 'IN_REVIEW' && (
            <span>In review — a moderator will take a look and follow up.</span>
          )}
          {post.moderationState === 'BLOCKED' && (
            <div>
              <div style={{ color: 'var(--red)', fontWeight: 600 }}>
                Blocked by moderation
              </div>
              {post.moderationReason && (
                <div className="mt-1">Reason: {post.moderationReason}</div>
              )}
              {disputeMsg || post.disputed ? (
                <div className="mt-2">
                  {disputeMsg ??
                    'Dispute received — our team will give you feedback within 48 hours.'}
                </div>
              ) : post.canDispute ? (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    value={disputeNote}
                    onChange={(e) => setDisputeNote(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Tell us why this should be reviewed…"
                    className="w-full px-2 py-1.5 rounded-[6px] text-[12px] resize-y"
                    style={{
                      background: 'var(--bg-card)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitDispute}
                    disabled={disputing}
                    className="gg-press self-start px-3 py-1.5 rounded-[6px] text-[12px] font-medium"
                    style={{ background: 'var(--red)', color: '#fff' }}
                  >
                    {disputing ? 'Sending…' : 'Dispute this decision'}
                  </button>
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    You&apos;ll get feedback within 48 hours.
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      <div className="px-4 pt-3">
        {post.title && (
          <h2
            className="text-[16px] font-medium mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            {post.title}
          </h2>
        )}
        <p
          className="text-[14px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--text-secondary)' }}
        >
          {post.body}
        </p>
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {post.tags.map((t) => (
              <span
                key={t}
                className="text-[12px]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {(post.images.length > 0 || post.video) && (
        <div className="mt-3 px-4">
          <div className="relative rounded-[6px] overflow-hidden">
            <div
              className="flex flex-col gap-1"
              style={{
                filter: graphic && !revealed ? 'blur(18px)' : 'none',
              }}
            >
              {post.video && (
                <video
                  src={post.video.playbackUrl || post.video.url}
                  poster={post.video.thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full"
                  style={{
                    maxHeight: 640,
                    background: 'var(--bg-inset)',
                    display: 'block',
                  }}
                />
              )}
              {post.images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setViewer(i)}
                  aria-label={`Open photo ${i + 1}`}
                  style={{
                    border: 0,
                    padding: 0,
                    background: 'transparent',
                    cursor: 'zoom-in',
                    display: 'block',
                    width: '100%',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    className="w-full"
                    style={{
                      // ⚠️ CONTAIN, NOT COVER. object-cover cropped the member's
                      // photo to fill the box. A feed must show the picture they
                      // posted, whole.
                      height: 'auto',
                      maxHeight: 640,
                      objectFit: 'contain',
                      background: 'var(--bg-inset)',
                      display: 'block',
                    }}
                  />
                </button>
              ))}
            </div>
            {graphic && !revealed && hiddenForever && (
              <div
                className="absolute inset-0 flex items-center justify-center text-center px-4"
                style={{
                  background: 'color-mix(in srgb, var(--bg-card) 30%, transparent)',
                }}
              >
                <span className="flex flex-col items-center" style={overlayBoxStyle}>
                  <span style={{ fontSize: 39, fontWeight: 700, lineHeight: 1.1 }}>
                    Graphic content hidden
                  </span>
                  <span style={{ fontSize: 36, marginTop: 8, opacity: 0.9 }}>
                    Blurred for everyone
                  </span>
                </span>
              </div>
            )}
            {graphic && !revealed && !hiddenForever && (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                aria-label="Graphic content — tap to reveal"
                className="absolute inset-0 flex items-center justify-center text-center px-4"
                style={{
                  background: 'color-mix(in srgb, var(--bg-card) 30%, transparent)',
                }}
              >
                <span className="flex flex-col items-center" style={overlayBoxStyle}>
                  <span style={{ fontSize: 39, fontWeight: 700, lineHeight: 1.1 }}>
                    Graphic content
                  </span>
                  <span style={{ fontSize: 36, marginTop: 8, opacity: 0.9 }}>
                    Tap to reveal
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {post.listing && (
        <div className="mx-4 mt-3">
          <a
            href={`/listings/${post.listing.id}`}
            className="gg-press flex items-center gap-3 px-3 py-2 rounded-[6px]"
            style={{
              border: '0.5px solid var(--border)',
              background: 'var(--bg-inset)',
            }}
          >
            <span
              className="text-[13px] font-medium flex-1 truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {post.listing.title}
            </span>
            {typeof post.listing.price === 'number' && (
              <span
                className="text-[13px] font-medium"
                style={{ color: 'var(--red)' }}
              >
                R{(post.listing.price / 100).toLocaleString('en-ZA')}
              </span>
            )}
          </a>
        </div>
      )}

      <footer className="flex items-center gap-1 px-2 py-2 mt-1">
        <button
          type="button"
          onClick={() => onToggleLike(post)}
          className="gg-press flex items-center gap-1.5 px-3 py-2 rounded text-[13px]"
          style={{ color: post.liked ? 'var(--red)' : 'var(--text-tertiary)' }}
          aria-pressed={post.liked}
        >
          <span>{post.liked ? '♥' : '♡'}</span>
          <span>{post.likeCount}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen?.(post)}
          className="gg-press flex items-center gap-1.5 px-3 py-2 rounded text-[13px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          💬 {post.commentCount}
        </button>
        <button
          type="button"
          onClick={share}
          className="gg-press flex items-center gap-1.5 px-3 py-2 rounded text-[13px]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Share
        </button>
      </footer>

      {viewer !== null && post.images.length > 0 && (
        <ImageLightbox
          images={post.images}
          startIndex={viewer}
          title={post.title ?? undefined}
          onClose={() => setViewer(null)}
        />
      )}
    </article>
  );
}
