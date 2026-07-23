'use client';

import { useRef, useState, DragEvent } from 'react';
import { normalizeImageForUpload, isHeic } from '@/lib/heic-to-jpeg';

// Drag-and-drop photo dropzone with thumbnail previews, drag-to-reorder,
// set-as-hero, and remove buttons. Files are kept in the parent's state;
// this component only renders UI and reports the new file list back.
//
// Two distinct "drag" interactions live here:
//   1. Drag a file from the OS into the dropzone — adds it to the list.
//   2. Drag one thumbnail over another — reorders the existing list.
// The browser fires the same dragstart/dragover events for both; we
// differentiate by checking `dataTransfer.files.length`.

interface Props {
  files: File[];
  onChange: (next: File[]) => void;
  accept?: string;
  minFiles?: number;
  maxFiles?: number;
}

export function PhotoDropzone({
  files,
  onChange,
  // HEIC/HEIF included so iPhone photos picked from the Files app (or when
  // Safari hands over the original instead of auto-converting) are accepted —
  // the backend validators allow them and Cloudinary converts on delivery.
  accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif',
  minFiles = 1,
  maxFiles = 5,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOverDrop, setDragOverDrop] = useState(false);
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Cache object URLs across renders so we don't re-create them every time
  // (which would cause a flash) and revoke them when the file goes away.
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());

  function syncPreviews(list: File[]) {
    const next = new Map<File, string>();
    for (const f of list) {
      const existing = previews.get(f);
      next.set(f, existing ?? URL.createObjectURL(f));
    }
    for (const [f, url] of previews) {
      if (!next.has(f)) URL.revokeObjectURL(url);
    }
    setPreviews(next);
  }

  async function addFiles(incoming: FileList | File[]) {
    // Accept by MIME OR by .heic/.heif extension — the Files app sometimes
    // hands over a HEIC with an empty type, which the MIME test alone misses.
    const arr = Array.from(incoming).filter(
      (f) => f.type.startsWith('image/') || isHeic(f),
    );
    if (arr.length === 0) return;
    // Convert any HEIC/HEIF to JPEG up front so the preview, the pre-publish
    // vision moderation and the upload all see a supported format.
    const normalized = await Promise.all(arr.map(normalizeImageForUpload));
    const merged = [...files, ...normalized].slice(0, maxFiles);
    syncPreviews(merged);
    onChange(merged);
  }

  function removeAt(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    syncPreviews(next);
    onChange(next);
  }

  function moveToHero(idx: number) {
    if (idx === 0) return;
    const next = [...files];
    const [target] = next.splice(idx, 1);
    next.unshift(target);
    onChange(next);
  }

  // OS-file drop on the dropzone area
  function handleDropZoneDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverDrop(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleDropZoneDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragOverDrop) setDragOverDrop(true);
  }

  function handleDropZoneDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverDrop(false);
  }

  // Thumbnail-to-thumbnail reorder
  function handleThumbDragStart(idx: number) {
    setDragSourceIdx(idx);
  }
  function handleThumbDragOver(e: DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    if (dragSourceIdx !== null && dragSourceIdx !== idx) {
      setDragOverIdx(idx);
    }
  }
  function handleThumbDragEnd() {
    setDragSourceIdx(null);
    setDragOverIdx(null);
  }
  function handleThumbDrop(e: DragEvent<HTMLDivElement>, targetIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    const sourceIdx = dragSourceIdx;
    setDragSourceIdx(null);
    setDragOverIdx(null);
    if (sourceIdx === null || sourceIdx === targetIdx) return;
    const next = [...files];
    const [moved] = next.splice(sourceIdx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
  }

  const slotsLeft = maxFiles - files.length;
  const belowMin = files.length < minFiles;

  return (
    <div>
      {/* Drop area */}
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDropZoneDrop}
        onDragOver={handleDropZoneDragOver}
        onDragLeave={handleDropZoneDragLeave}
        className="rounded-[8px] text-center transition-colors cursor-pointer"
        style={{
          padding: '36px 16px',
          background: dragOverDrop ? 'rgba(200,16,46,0.06)' : 'var(--bg-inset)',
          border: dragOverDrop
            ? '0.5px dashed var(--red)'
            : belowMin
              ? '0.5px dashed var(--red)'
              : '0.5px dashed var(--border-hover)',
        }}
      >
        <div
          className="text-sm mb-1"
          style={{
            color: dragOverDrop ? 'var(--red)' : 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {dragOverDrop ? 'Drop to upload' : 'Drop photos here or click to upload'}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          JPG, PNG, or WebP · {minFiles}–{maxFiles} photos · first photo is the cover · drag to reorder
        </div>

        {/* NO `capture` attribute — deliberately. With `capture` set,
            iOS Safari opens the rear camera IMMEDIATELY with no other
            option (it does NOT offer a gallery/files fallback, contrary
            to a common misconception), which trapped mobile sellers who
            wanted to upload existing photos. Without it, tapping the
            dropzone shows the OS's native source sheet — Photo Library /
            Take Photo / Choose File on iOS, and the Camera/Gallery/Files
            chooser on Android — so the user picks the source themselves.
            `multiple` lets them select several gallery photos at once. */}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Min-photo nag */}
      {belowMin && (
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--red)' }}
        >
          At least {minFiles} photo is required before you can publish.
        </p>
      )}

      {/* Thumbnail grid */}
      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {files.map((file, idx) => {
            const isHero = idx === 0;
            const isDragSource = dragSourceIdx === idx;
            const isDragOver = dragOverIdx === idx;
            return (
              <div
                key={file.name + idx}
                draggable
                onDragStart={() => handleThumbDragStart(idx)}
                onDragOver={(e) => handleThumbDragOver(e, idx)}
                onDragEnd={handleThumbDragEnd}
                onDrop={(e) => handleThumbDrop(e, idx)}
                className="relative rounded-[6px] overflow-hidden group"
                style={{
                  aspectRatio: '1/1',
                  background: 'var(--bg-inset)',
                  border: isDragOver
                    ? '0.5px solid var(--red)'
                    : isHero
                      ? '0.5px solid var(--red)'
                      : '0.5px solid var(--border)',
                  cursor: 'grab',
                  opacity: isDragSource ? 0.3 : 1,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews.get(file)}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none"
                  draggable={false}
                />

                {/* Cover badge */}
                {isHero && (
                  <span
                    className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5 rounded-[3px]"
                    style={{
                      background: 'var(--red)',
                      color: '#fff',
                      fontWeight: 500,
                      fontSize: 10,
                      pointerEvents: 'none',
                    }}
                  >
                    Cover
                  </span>
                )}

                {/* Make-cover button — always visible on non-cover photos
                    so the seller can see at a glance which thumbnails are
                    clickable for promotion (previously hover-only, easy
                    to miss). */}
                {!isHero && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveToHero(idx);
                    }}
                    className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5 rounded-[3px]"
                    style={{
                      background: 'rgba(10,10,10,0.85)',
                      color: '#fff',
                      border: '0.5px solid rgba(255,255,255,0.15)',
                      cursor: 'pointer',
                      lineHeight: 1.2,
                      fontSize: 10,
                    }}
                  >
                    Make cover
                  </button>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(idx);
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs"
                  style={{
                    background: 'rgba(10,10,10,0.85)',
                    color: '#fff',
                    border: '0.5px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                  aria-label="Remove photo"
                >
                  ×
                </button>

                {/* Order index — bottom-right */}
                <span
                  className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(10,10,10,0.85)',
                    color: 'var(--text-tertiary)',
                    fontSize: 9,
                    pointerEvents: 'none',
                  }}
                >
                  {idx + 1}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Slot counter */}
      <p
        className="text-xs mt-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {files.length} of {maxFiles} photo{files.length === 1 ? '' : 's'}
        {slotsLeft > 0
          ? ` · ${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left`
          : ' · limit reached'}
      </p>
    </div>
  );
}
