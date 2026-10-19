'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';

const ACCEPTED = 'video/mp4,video/quicktime,video/webm';
export const MAX_SELL_VIDEO_BYTES = 64 * 1024 * 1024;

function humanMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * One optional marketplace clip for the Sell form. Kept deliberately simple:
 * pick a file (or drop one), preview it locally, remove it. The upload (and
 * the server-side moderation) happens at publish, not here — a 64 MB clip
 * must not be base64'd through the JSON preview endpoint.
 */
export function VideoDropzone({
  file,
  onChange,
  existingUrl = null,
  existingThumbnailUrl = null,
  onRemoveExisting,
  maxBytes = MAX_SELL_VIDEO_BYTES,
}: {
  file: File | null;
  onChange: (next: File | null) => void;
  /** A video already on the listing (edit page). */
  existingUrl?: string | null;
  existingThumbnailUrl?: string | null;
  onRemoveExisting?: () => void;
  maxBytes?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(f: File) {
    setError(null);
    if (!/^video\/(mp4|quicktime|webm)$/i.test(f.type)) {
      setError('Use an MP4, MOV or WebM video.');
      return;
    }
    if (f.size > maxBytes) {
      setError(`That video is ${humanMb(f.size)} — the limit is ${humanMb(maxBytes)}.`);
      return;
    }
    onChange(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) accept(f);
  }

  const shownUrl = previewUrl ?? existingUrl;
  const poster = previewUrl ? undefined : existingThumbnailUrl ?? undefined;
  const hasAny = !!file || !!existingUrl;

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        className="rounded-[8px] text-center transition-colors cursor-pointer"
        style={{
          padding: '20px 16px',
          background: dragOver ? 'rgba(227,6,19,0.06)' : 'var(--bg-inset)',
          border: dragOver
            ? '0.5px dashed var(--red)'
            : '0.5px dashed var(--border-hover)',
        }}
      >
        <div
          className="text-sm mb-1"
          style={{
            color: dragOver ? 'var(--red)' : 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {hasAny ? 'Replace video' : 'Add a video (optional)'}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          MP4, MOV or WebM · one clip up to {humanMb(maxBytes)} · no audio is
          screened, so keep any contact details out of the picture
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) accept(f);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {shownUrl && (
        <div className="mt-3">
          <video
            src={shownUrl}
            poster={poster}
            controls
            playsInline
            preload="metadata"
            style={{
              width: '100%',
              maxHeight: 360,
              background: '#000',
              borderRadius: 6,
              display: 'block',
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {file ? `${file.name} · ${humanMb(file.size)}` : 'Current listing video'}
            </span>
            <button
              type="button"
              onClick={() => {
                if (file) onChange(null);
                else onRemoveExisting?.();
                setError(null);
              }}
              className="text-xs px-2 py-1 rounded-[4px]"
              style={{
                background: 'transparent',
                color: 'var(--red)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Remove video
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
