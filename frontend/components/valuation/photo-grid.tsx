'use client';

import type { ValuationImageView } from '../../lib/valuation-api';

/**
 * The 8-slot photo grid, shared by the desktop intake and the phone capture
 * page: filled slots show a thumbnail with an X badge to delete, empty slots
 * show a dashed outline with the slot number. Desktop and phone render the
 * same state from the same API shapes.
 */
export function PhotoGrid({
  images,
  maxPhotos,
  onDelete,
  busyId,
}: {
  images: ValuationImageView[];
  maxPhotos: number;
  onDelete: (photoId: string) => void;
  busyId?: string | null;
}) {
  const slots = Array.from({ length: maxPhotos }, (_, i) => images[i] ?? null);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {slots.map((image, index) => (
        <div
          key={image?.id ?? `empty-${index}`}
          className="relative aspect-square rounded-[10px] overflow-hidden"
          style={{
            background: 'var(--bg-inset)',
            border: image ? '0.5px solid var(--border)' : '1px dashed var(--border)',
            opacity: busyId === image?.id ? 0.5 : 1,
          }}
        >
          {image ? (
            <>
              <img
                src={image.url}
                alt={image.viewTag ? `Item photo, ${image.viewTag}` : `Item photo ${index + 1}`}
                className="w-full h-full object-cover"
              />
              {image.viewTag && (
                <span
                  className="absolute left-1.5 bottom-1.5 text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                >
                  {image.viewTag.replace(/_/g, ' ').toLowerCase()}
                </span>
              )}
              <button
                type="button"
                onClick={() => onDelete(image.id)}
                disabled={busyId === image.id}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute top-1.5 right-1.5 inline-flex items-center justify-center"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  lineHeight: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          ) : (
            <span
              className="absolute inset-0 flex items-center justify-center text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {index + 1}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
