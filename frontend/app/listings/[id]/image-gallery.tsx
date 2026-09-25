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

// Self-contained gallery for the listing detail page.
//   - Top: hero image, clickable to open the lightbox.
//   - Below: horizontal thumbnail strip that swaps the hero in place
//     (instant, no overlay) — same behaviour as the marketplace
//     thumbnails you'd expect.
//   - Lightbox: the shared ImageLightbox (fullscreen, 2× zoom, drag to
//     pan, ← → navigation, Esc/backdrop to close) — the SAME viewer the
//     community feed uses, so there is one implementation.
//
// This stays a client component because it needs useState + the lightbox;
// the parent page remains a server component for SEO.
export function ImageGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  // Active hero / lightbox cursor. Both views read the same index so
  // closing the lightbox returns the user to the picture they were
  // looking at, not the original primary.
  const initial = Math.max(
    0,
    images.findIndex((i) => i.isPrimary),
  );
  const [activeIdx, setActiveIdx] = useState(initial);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const hasImages = images.length > 0;
  const active = hasImages ? images[activeIdx] ?? images[0] : null;

  const openAt = useCallback((idx: number) => {
    setActiveIdx(idx);
    setLightboxOpen(true);
  }, []);

  if (!hasImages || !active) {
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
      {/* Hero — clickable to open lightbox at this index. Cursor
          zoom-in tells the user it expands; tabbable + Enter/Space
          for keyboard users.
          NOTE: aspectRatio gives the button its intrinsic height; we
          do NOT use the paddingBottom % hack here because button
          elements default-style "padding" to a non-zero browser
          stylesheet rule that would override paddingBottom. */}
      <button
        type="button"
        onClick={() => openAt(activeIdx)}
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
        <Image
          src={active.url}
          alt={title}
          fill
          className="object-contain"
          priority
          sizes="(max-width: 1024px) 100vw, 60vw"
        />
      </button>

      {/* Thumbnail strip — sits BELOW the hero (not over it) but centred,
          so the row spreads symmetrically about the middle. Active
          thumbnail gets a red outline. */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-2 gg-row pb-1 justify-center">
          {images.map((img, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => setActiveIdx(idx)}
                onDoubleClick={() => openAt(idx)}
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
          startIndex={activeIdx}
          title={title}
          onClose={(idx) => {
            setActiveIdx(idx);
            setLightboxOpen(false);
          }}
        />
      )}
    </>
  );
}
