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
  audioEnabled = false,
  onAudioChange,
  existingUrl = null,
  existingThumbnailUrl = null,
  onRemoveExisting,
  maxBytes = MAX_SELL_VIDEO_BYTES,
  status,
  isHero = false,
  onHeroChange,
}: {
  file: File | null;
  onChange: (next: File | null) => void;
  /** Publish the clip with its audio track. Defaults to muted. */
  audioEnabled?: boolean;
  onAudioChange?: (next: boolean) => void;
  /** A video already on the listing (edit page). */
  existingUrl?: string | null;
  existingThumbnailUrl?: string | null;
  onRemoveExisting?: () => void;
  maxBytes?: number;
  /** Early moderation status, shown under the file name. */
  status?: string;
  /** Show the clip first, as the listing cover, instead of after the photos. */
  isHero?: boolean;
  onHeroChange?: (next: boolean) => void;
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
          MP4, MOV or WebM · one clip up to {humanMb(maxBytes)} · choose
          whether it is published with sound. We screen the picture either
          way; a sound-on clip is screened for spoken contact details too.
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

      <div className="mt-3">
        <div
          className="text-xs"
          style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
        >
          Sound
        </div>
        <div role="group" aria-label="Video sound" className="flex gap-2 mt-1.5">
          {[
            { on: false, label: 'Without sound' },
            { on: true, label: 'With sound' },
          ].map((opt) => {
            const selected = audioEnabled === opt.on;
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={selected}
                onClick={() => onAudioChange?.(opt.on)}
                className="text-xs px-3 py-1.5 rounded-[6px]"
                style={{
                  background: selected ? 'var(--red)' : 'var(--bg-inset)',
                  color: selected ? '#fff' : 'var(--text-secondary)',
                  border: `0.5px solid ${selected ? 'var(--red)' : 'var(--border)'}`,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p
          className="text-xs mt-1.5"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
        >
          {audioEnabled
            ? 'We screen the audio for spoken contact details and advertising. Only include sound if you have consent from anyone audible.'
            : 'The audio is removed before the clip is published.'}
        </p>
      </div>

      {hasAny && onHeroChange && (
        <button
          type="button"
          role="checkbox"
          aria-checked={isHero}
          onClick={() => onHeroChange(!isHero)}
          className="mt-3 flex w-full items-start gap-3 rounded-[6px] px-3 py-2.5 text-left"
          style={{
            background: isHero ? 'rgba(227,6,19,0.06)' : 'var(--bg-inset)',
            border: `0.5px solid ${isHero ? 'var(--red)' : 'var(--border)'}`,
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]"
            style={{
              background: isHero ? 'var(--red)' : 'transparent',
              border: `1px solid ${isHero ? 'var(--red)' : 'var(--border-hover)'}`,
              color: '#fff',
              fontSize: 10,
              lineHeight: 1,
            }}
          >
            {isHero && (
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M2 6.5 4.7 9 10 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
          <span>
            <span
              className="text-xs block"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Use the video as the cover
            </span>
            <span
              className="text-xs block mt-0.5"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
            >
              {isHero
                ? 'Buyers see the video first and can play it from the cover thumbnail.'
                : 'Your first photo stays the cover; the video follows it.'}
            </span>
          </span>
        </button>
      )}

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
            muted={!audioEnabled}
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
              {status ? ` · ${status}` : ''}
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
