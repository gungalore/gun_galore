'use client';

import { useState, type CSSProperties } from 'react';
import { useAuth } from '../../lib/auth';
import { type FeedPost, disputePost } from '../../lib/community-api';
import { postTypeLabel } from '../../lib/post-types';
import { ImageLightbox } from '../image-lightbox';
import PostDetails from './post-details';

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
  /** Member preference: show graphic content. Default true. */
  showGraphic?: boolean;
}

/**
 * A post's tagged place opens in the member's maps — the Google Maps universal
 * link hands off to the installed app on a phone and to the website on desktop.
 * `query_place_id` pins it to the exact place the member picked; without it the
 * query is just a name and Maps lands on a generic search.
 */
function mapsUrl(location: string, placeId?: string | null): string {
  const query = encodeURIComponent(location);
  const base = `https://www.google.com/maps/search/?api=1&query=${query}`;
  return placeId ? `${base}&query_place_id=${encodeURIComponent(placeId)}` : base;
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
  showGraphic = true,
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
  // showGraphic false (member preference) blurs all graphic content.
  const hiddenForever =
    graphic && post.graphicTier === 'EXTREME' && (!!forceBlur || !showGraphic);

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
      className="gg-tile gg-tile-lift rounded-lg"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        // ⚠️ NO `overflow-hidden` HERE, AND A HIGHER z-index WHILE THE ⋯ MENU IS
        // OPEN. The tile clipped its own dropdown: the menu is absolutely
        // positioned and can extend past the card's bottom edge, and
        // `overflow-hidden` (there to round the media corners) sliced it off at
        // the border. The media wrapper below keeps its own `overflow-hidden`
        // for its own rounded corners. The z-index is raised because each card
        // is its own `gg-tile-lift` stacking context at z-index 0; without it
        // the NEXT card in the feed would paint over an open menu that reaches
        // into it. (`.gg-tile-lift:focus-within` handles the mouse case; this
        // covers touch/Safari, where a tapped button does not take focus.)
        zIndex: menuOpen ? 30 : undefined,
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
            <span
              className="text-[12px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              · {timeAgo(post.createdAt)}
            </span>
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
        <PostDetails type={post.type} post={post} className="mt-2" />
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
        {post.location && (
          <a
            href={mapsUrl(post.location, post.locationPlaceId)}
            target="_blank"
            rel="noopener noreferrer"
            className="gg-press hover:underline inline-flex items-center gap-1 mt-2 text-[12px]"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label={`Open ${post.location} in maps`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {post.location}
          </a>
        )}
      </div>

      {(post.images.length > 0 || post.video) && (
        <div className="mt-3 px-4">
          <div className="relative rounded-lg overflow-hidden">
            <div
              className="flex flex-col gap-1"
              style={{
                filter: graphic && !revealed ? 'blur(28px)' : 'none',
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
            {graphic && !revealed && (
              <div
                className="absolute inset-0 flex items-center justify-center text-center px-4"
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  backdropFilter: 'blur(28px)',
                }}
              >
                <div className="flex flex-col items-center gap-3 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </div>
                  <span className="text-white text-base font-semibold">Graphic content</span>
                  <span className="text-white/80 text-sm">
                    {post.graphicTier === 'EXTREME' ? 'This post shows a harvested animal.' : 'Tap to reveal'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="bg-white text-[var(--stone-900)] px-4 py-2 rounded-full text-sm font-medium"
                  >
                    {post.graphicTier === 'EXTREME' ? 'Show image' : 'Tap to reveal'}
                  </button>
                </div>
              </div>
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
