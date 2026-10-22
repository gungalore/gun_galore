'use client';

import type { FeedImage, FeedPost } from '../../lib/community-api';

/**
 * Facebook-style photo collage. One photo fills the width, two sit side by
 * side, three use a tall left tile with two stacked on the right, four make a
 * 2×2, and five or more show a tall left tile plus three on the right with a
 * "+N" badge on the last. Every tile opens the lightbox at that index.
 *
 * ⚠️ A single photo keeps `object-fit: contain` so the member's picture is
 * shown whole; collage tiles crop (`cover`) because that is how a grid reads.
 */
export function PostCollage({
  post,
  onOpen,
  gated = false,
  revealed = true,
  hiddenForever = false,
  onReveal,
}: {
  post: FeedPost;
  onOpen: (index: number) => void;
  gated?: boolean;
  revealed?: boolean;
  hiddenForever?: boolean;
  onReveal?: () => void;
}) {
  const images = post.images;
  const count = images.length;
  if (count === 0 && !post.video) return null;

  const blur = gated && !revealed;

  return (
    <div className="mt-3 px-4">
      <div className="relative rounded-lg overflow-hidden">
        <div
          className="flex flex-col gap-1"
          style={{ filter: blur ? 'blur(28px)' : 'none' }}
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
          {count === 1 && (
            <Tile
              image={images[0]}
              index={0}
              onOpen={onOpen}
              contain
            />
          )}
          {count === 2 && (
            <div className="grid grid-cols-2 gap-1">
              {images.map((img, i) => (
                <Tile key={img.id} image={img} index={i} onOpen={onOpen} />
              ))}
            </div>
          )}
          {count === 3 && (
            <div className="grid grid-cols-2 grid-rows-2 gap-1 h-[320px]">
              <div className="row-span-2 min-h-0">
                <Tile image={images[0]} index={0} onOpen={onOpen} fill />
              </div>
              <div className="min-h-0">
                <Tile image={images[1]} index={1} onOpen={onOpen} fill />
              </div>
              <div className="min-h-0">
                <Tile image={images[2]} index={2} onOpen={onOpen} fill />
              </div>
            </div>
          )}
          {count === 4 && (
            <div className="grid grid-cols-2 grid-rows-2 gap-1 h-[320px]">
              {images.map((img, i) => (
                <div key={img.id} className="min-h-0">
                  <Tile image={img} index={i} onOpen={onOpen} fill />
                </div>
              ))}
            </div>
          )}
          {count >= 5 && (
            <div className="grid grid-cols-2 grid-rows-2 gap-1 h-[320px]">
              <div className="row-span-2 min-h-0">
                <Tile image={images[0]} index={0} onOpen={onOpen} fill />
              </div>
              {[1, 2, 3].map((i) => (
                <div key={images[i].id} className="min-h-0 relative">
                  <Tile image={images[i]} index={i} onOpen={onOpen} fill />
                  {i === 3 && count > 4 && (
                    <button
                      type="button"
                      onClick={() => onOpen(i)}
                      aria-label={`Open photo ${i + 1} of ${count}`}
                      className="absolute inset-0 flex items-center justify-center text-white text-[22px] font-semibold"
                      style={{ background: 'rgba(0,0,0,0.45)' }}
                    >
                      +{count - 4}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {blur && (
          <div
            className="absolute inset-0 flex items-center justify-center text-center px-4"
            style={{
              background: 'rgba(0,0,0,0.35)',
              backdropFilter: 'blur(28px)',
            }}
          >
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </div>
              <span className="text-white text-base font-semibold">
                Graphic content
              </span>
              <span className="text-white/80 text-sm">
                {post.graphicTier === 'EXTREME'
                  ? 'This post shows a harvested animal.'
                  : 'Tap to reveal'}
              </span>
              {!hiddenForever && (
                <button
                  type="button"
                  onClick={onReveal}
                  className="bg-white text-[var(--stone-900)] px-4 py-2 rounded-full text-sm font-medium"
                >
                  {post.graphicTier === 'EXTREME' ? 'Show image' : 'Tap to reveal'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  image,
  index,
  onOpen,
  fill,
  contain,
}: {
  image: FeedImage;
  index: number;
  onOpen: (index: number) => void;
  fill?: boolean;
  contain?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      aria-label={`Open photo ${index + 1}`}
      style={{
        border: 0,
        padding: 0,
        background: 'var(--bg-inset)',
        cursor: 'zoom-in',
        display: 'block',
        width: '100%',
        height: fill ? '100%' : undefined,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        className="w-full"
        style={
          fill
            ? { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
            : {
                height: 'auto',
                maxHeight: 640,
                objectFit: contain ? 'contain' : 'cover',
                background: 'var(--bg-inset)',
                display: 'block',
              }
        }
      />
    </button>
  );
}
