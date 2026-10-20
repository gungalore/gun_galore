'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import { ImageLightbox } from '@/components/image-lightbox';

// Subset of Prisma's ListingImage that the gallery actually reads.
// Mirrors the inline interface used on the listing detail page so we
// don't drag a deep relation type across the client/server boundary.
interface GalleryImage {
  id: string;
  url: string;
  isPrimary?: boolean;
}

export interface GalleryVideo {
  id: string;
  url: string;
  playbackUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  /** False when the seller published the clip without sound. */
  audioEnabled?: boolean;
}

// Self-contained gallery for the listing detail page.
//   - Top: hero image OR the listing's video, clickable to open the lightbox
//     (photos) / played inline (video).
//   - Below: horizontal thumbnail strip that swaps the hero in place
//     (instant, no overlay). A video, when present, is the FIRST tile.
//   - Lightbox: the shared ImageLightbox (fullscreen, 2× zoom, drag to
//     pan, ← → navigation, Esc/backdrop to close) — the SAME viewer the
//     community feed uses, so there is one implementation.
//
// This stays a client component because it needs useState + the lightbox;
// the parent page remains a server component for SEO.
export function ImageGallery({
  images,
  video,
  title,
}: {
  images: GalleryImage[];
  video?: GalleryVideo | null;
  title: string;
}) {
  // Active hero / lightbox cursor. Both views read the same index so
  // closing the lightbox returns the user to the picture they were
  // looking at, not the original primary. When a video exists it is
  // slide 0 and the photos shift by one.
  const hasVideo = !!video;
  const initialImage = Math.max(
    0,
    images.findIndex((i) => i.isPrimary),
  );
  const [activeIdx, setActiveIdx] = useState(
    hasVideo ? 0 : initialImage,
  );
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const hasImages = images.length > 0;
  const slideCount = (hasVideo ? 1 : 0) + images.length;
  const clampIdx = (i: number) =>
    slideCount === 0 ? 0 : Math.min(Math.max(0, i), slideCount - 1);
  const active = clampIdx(activeIdx);
  const videoActive = hasVideo && active === 0;
  const imageIndex = hasVideo ? active - 1 : active;
  const activeImage = hasImages ? images[imageIndex] ?? images[0] : null;

  const openAt = useCallback((idx: number) => {
    setActiveIdx(idx);
    setLightboxOpen(true);
  }, []);

  if (slideCount === 0) {
    return (
      <div
        className="relative rounded-[6px] overflow-hidden"
        style={{ aspectRatio: '4 / 3', background: 'var(--bg-inset)' }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          No photos
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Hero — video plays inline; a photo opens the lightbox at its index.
          NOTE: aspectRatio gives the button its intrinsic height; we do NOT
          use the paddingBottom % hack here because button elements
          default-style "padding" to a non-zero browser stylesheet rule that
          would override paddingBottom. */}
      {videoActive && video ? (
        <div
          className="relative rounded-[6px] overflow-hidden"
          style={{ aspectRatio: '4 / 3', background: '#000' }}
        >
          <video
            src={video.playbackUrl || video.url}
            poster={video.thumbnailUrl ?? undefined}
            controls
            muted={video.audioEnabled === false}
            playsInline
            preload="metadata"
            aria-label={`${title} video`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#000',
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openAt(active)}
          aria-label={`Open ${title} photos`}
          className="relative rounded-[6px] overflow-hidden block w-full"
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--bg-inset)',
            cursor: 'zoom-in',
            border: 0,
            padding: 0,
          }}
        >
          {activeImage && (
            <Image
              src={activeImage.url}
              alt={title}
              fill
              className="object-contain"
              priority
              sizes="(max-width: 1024px) 100vw, 60vw"
            />
          )}
        </button>
      )}

      {/* Thumbnail strip — sits BELOW the hero (not over it) but centred,
          so the row spreads symmetrically about the middle. Active
          thumbnail gets a red outline. Video is the first tile. */}
      {slideCount > 1 && (
        <div className="flex gap-2 mt-2 gg-row pb-1 justify-center">
          {hasVideo && video && (
            <button
              key={video.id}
              type="button"
              onClick={() => setActiveIdx(0)}
              aria-label="Show video"
              aria-current={active === 0 ? 'true' : undefined}
              className="relative flex-shrink-0 w-20 h-20 rounded-[4px] overflow-hidden"
              style={{
                background: 'var(--bg-inset)',
                border:
                  active === 0
                    ? '1.5px solid var(--red)'
                    : '0.5px solid var(--border)',
                cursor: 'pointer',
                padding: 0,
                opacity: active === 0 ? 1 : 0.85,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              {video.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              ) : null}
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center"
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                  }}
                >
                  ▶
                </span>
              </span>
            </button>
          )}
          {images.map((img, idx) => {
            const slide = idx + (hasVideo ? 1 : 0);
            const isActive = slide === active;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveIdx(slide)}
                onDoubleClick={() => openAt(slide)}
                aria-label={`Show photo ${idx + 1} of ${images.length}`}
                aria-current={isActive ? 'true' : undefined}
                className="relative flex-shrink-0 w-20 h-20 rounded-[4px] overflow-hidden"
                style={{
                  background: 'var(--bg-inset)',
                  border: isActive
                    ? '1.5px solid var(--red)'
                    : '0.5px solid var(--border)',
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isActive ? 1 : 0.85,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <Image
                  src={img.url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </button>
            );
          })}
        </div>
      )}

      {lightboxOpen && (
        <ImageLightbox
          images={images}
          startIndex={Math.max(0, imageIndex)}
          title={title}
          onClose={(idx) => {
            setActiveIdx(idx + (hasVideo ? 1 : 0));
            setLightboxOpen(false);
          }}
        />
      )}
    </>
  );
}
