'use client';

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { AskGgFairUseCoolOff, AskGgQuota } from '@/lib/use-ask-gg';
import { IconPaperclip, IconSend, IconX } from './icons';

/** Imperative surface the page uses from "New chat": clears the staged
 *  photos + photo error without remounting the composer (so focus and
 *  the textarea DOM node survive, exactly as before the extraction). */
export interface ComposerHandle {
  resetStaging: () => void;
}

export interface ComposerProps {
  /** Controlled composer text (lives in the page — the KB-search
   *  debounce and the EmptyState starter tiles both need it). */
  value: string;
  onValueChange: (value: string) => void;
  /** Ref to the textarea — the page focuses/scrolls it (startChat /
   *  newChat). */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  tierGated: boolean;
  fairUseCoolOff: AskGgFairUseCoolOff | null;
  quota: AskGgQuota | null;
  /** Phase B — upload staged photos, returns Cloudinary URLs. */
  uploadPhotos: (files: File[]) => Promise<string[]>;
  send: (
    content: string,
    opts?: { escalate?: boolean; imageUrls?: string[] },
  ) => Promise<void>;
  /** Called just before send() — the page clears its staged KB hits
   *  and resets the dismissed flag here (Phase C). */
  onBeforeSend: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      value,
      onValueChange,
      composerRef,
      sending,
      tierGated,
      fairUseCoolOff,
      quota,
      uploadPhotos,
      send,
      onBeforeSend,
    },
    ref,
  ) {
    // Phase B — photos staged but not yet uploaded. On Send: upload
    // first, then call send with the returned URLs.
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [uploadingPhotos, setUploadingPhotos] = useState(false);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        resetStaging: () => {
          setPendingFiles([]);
          setPhotoError(null);
        },
      }),
      [],
    );

    function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
      setPhotoError(null);
      const list = e.target.files ? Array.from(e.target.files) : [];
      if (list.length === 0) return;
      // Cap at 5 total (existing + new).
      const merged = [...pendingFiles, ...list].slice(0, 5);
      if (pendingFiles.length + list.length > 5) {
        setPhotoError('Up to 5 photos per message.');
      }
      // Client-side validation — keeps the picker responsive instead
      // of round-tripping to the server.
      const bad = merged.find(
        (f) =>
          !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 10 * 1024 * 1024,
      );
      if (bad) {
        setPhotoError(`${bad.name}: JPG/PNG/WebP only, ≤10 MB.`);
        // Reset the file input so the same file can be re-picked after
        // the user fixes whatever's wrong.
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setPendingFiles(merged);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function removePendingFile(idx: number) {
      setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
    }

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      if (!value.trim() && pendingFiles.length === 0) return;
      const v = value;
      const files = pendingFiles;

      // Upload photos first (if any). On upload failure, surface the
      // error and DON'T clear the composer — user can retry without
      // re-typing.
      let imageUrls: string[] = [];
      if (files.length > 0) {
        setUploadingPhotos(true);
        setPhotoError(null);
        try {
          imageUrls = await uploadPhotos(files);
        } catch (err) {
          setPhotoError(err instanceof Error ? err.message : 'Upload failed.');
          setUploadingPhotos(false);
          return;
        }
        setUploadingPhotos(false);
      }

      onValueChange('');
      setPendingFiles([]);
      // Phase C — sending clears the staged KB hits AND resets the
      // dismissed flag so future typing surfaces fresh suggestions
      // (handled by the page via onBeforeSend).
      onBeforeSend();
      await send(v, imageUrls.length > 0 ? { imageUrls } : undefined);
    }

    return (
      <>
        {/* Photo preview row — shown only when files are staged. */}
        {pendingFiles.length > 0 && (
          <PhotoPreviewRow
            files={pendingFiles}
            onRemove={removePendingFile}
            uploading={uploadingPhotos}
          />
        )}

        {/* Photo-specific error (size, type, upload failure). */}
        {photoError && (
          <p
            role="alert"
            style={{
              margin: '4px 0 0',
              padding: '7px 10px',
              fontSize: 12,
              color: 'var(--red)',
              background: 'rgba(200,16,46,0.10)',
              border: '0.5px solid var(--red)',
              borderRadius: 6,
            }}
          >
            {photoError}
          </p>
        )}

        {/* Composer — pinned to the bottom of the chat area. */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 0 16px',
            borderTop: '0.5px solid var(--border)',
            background: 'var(--bg)',
            alignItems: 'flex-end',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
          }}
        >
          {/* Hidden file input — triggered by the paperclip button.
              Multiple, capture=environment opens the rear camera on
              iOS / Android for fast in-the-shop snapshots. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            multiple
            onChange={handlePickFiles}
            disabled={
              tierGated ||
              !!fairUseCoolOff ||
              pendingFiles.length >= 5
            }
            style={{ display: 'none' }}
          />
          {/* Paperclip / camera button — opens the file picker. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              tierGated ||
              !!fairUseCoolOff ||
              uploadingPhotos ||
              pendingFiles.length >= 5
            }
            aria-label={
              pendingFiles.length >= 5
                ? '5 photo limit reached'
                : `Attach photo${
                    quota?.photos.tier === 'FREE' &&
                    !quota.photos.unlimited
                      ? ` (${quota.photos.remaining} left this month)`
                      : ''
                  }`
            }
            title={
              pendingFiles.length >= 5
                ? '5 photo limit reached'
                : 'Attach photo(s)'
            }
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 10,
              background: 'var(--bg-card)',
              color:
                tierGated ||
                fairUseCoolOff ||
                uploadingPhotos ||
                pendingFiles.length >= 5
                  ? 'var(--text-tertiary)'
                  : 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor:
                tierGated ||
                fairUseCoolOff ||
                uploadingPhotos ||
                pendingFiles.length >= 5
                  ? 'not-allowed'
                  : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconPaperclip />
          </button>
          <textarea
            ref={composerRef}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={
              tierGated
                ? 'Upgrade to keep chatting…'
                : fairUseCoolOff
                  ? 'Quick break — back in a moment…'
                  : pendingFiles.length > 0
                    ? 'Add a note about these photos (optional)…'
                    : 'Ask about gear, hunting, fishing, camping, overlanding…'
            }
            aria-label="Type your question"
            rows={1}
            disabled={tierGated || !!fairUseCoolOff}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 140,
              padding: '11px 14px',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              resize: 'none',
              outline: 'none',
              fontSize: 14,
              lineHeight: 1.4,
              fontFamily: 'inherit',
              opacity: tierGated || fairUseCoolOff ? 0.5 : 1,
            }}
          />
          <button
            type="submit"
            disabled={
              sending ||
              uploadingPhotos ||
              (!value.trim() && pendingFiles.length === 0) ||
              tierGated ||
              !!fairUseCoolOff
            }
            aria-label="Send"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 10,
              background:
                sending ||
                uploadingPhotos ||
                (!value.trim() && pendingFiles.length === 0) ||
                tierGated ||
                fairUseCoolOff
                  ? 'var(--bg-inset)'
                  : 'var(--red)',
              color:
                sending ||
                uploadingPhotos ||
                (!value.trim() && pendingFiles.length === 0) ||
                tierGated ||
                fairUseCoolOff
                  ? 'var(--text-tertiary)'
                  : '#fff',
              border: 'none',
              cursor: sending || uploadingPhotos ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 140ms',
            }}
          >
            <IconSend />
          </button>
        </form>
      </>
    );
  },
);

/** Staged-photo preview row above the composer (before send). Each
 *  thumbnail has an X to remove. Dimmed during upload so the user
 *  knows something's happening. */
export function PhotoPreviewRow({
  files,
  onRemove,
  uploading,
}: {
  files: File[];
  onRemove: (idx: number) => void;
  uploading: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 0',
        opacity: uploading ? 0.6 : 1,
      }}
    >
      {files.map((file, i) => {
        // Create a stable object URL per file render — revoked when
        // the file is removed or component unmounts.
        const url = URL.createObjectURL(file);
        return (
          <div
            key={`${file.name}-${file.size}-${i}`}
            style={{
              position: 'relative',
              width: 64,
              height: 64,
              borderRadius: 8,
              overflow: 'hidden',
              border: '0.5px solid var(--border)',
              background: 'var(--bg-card)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={file.name}
              onLoad={() => URL.revokeObjectURL(url)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              disabled={uploading}
              aria-label={`Remove ${file.name}`}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                cursor: uploading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <IconX />
            </button>
          </div>
        );
      })}
      {uploading && (
        <span
          style={{
            alignSelf: 'center',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
            marginLeft: 4,
          }}
        >
          Uploading…
        </span>
      )}
    </div>
  );
}
