'use client';

import { useEffect, useMemo, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// THE UNPLACED UPLOAD.
//
// Operator, 2026-10-28: "If it can't be identified a pop up window must
// present the user with the upload and ask for a brief description of what it
// is. the reader should then take that information and read or identify the
// document again and present it to jev to place in a container. No upload must
// enter the vault ever that will be a dormant document."
//
// One file at a time. Two description attempts, then the file is discarded and
// the member is told why. Nothing is stored until a container is found.
// ────────────────────────────────────────────────────────────────────

export interface UnplacedUpload {
  file: File;
  kind: string;
  /** Why the server could not place it. */
  reason: string;
  /** 1 after the automatic failure; each retry increments it. */
  attempts: number;
}

const MAX_ATTEMPTS = 3;

export default function UnplacedUploadDialog({
  item,
  busy,
  onRetry,
  onDiscard,
}: {
  item: UnplacedUpload;
  busy: boolean;
  onRetry: (description: string) => void;
  onDiscard: () => void;
}) {
  const [words, setWords] = useState('');
  const final = item.attempts >= MAX_ATTEMPTS;
  const preview = useMemo(() => {
    if (item.file.type.startsWith('image/')) return URL.createObjectURL(item.file);
    return null;
  }, [item.file]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unplaced-title"
        className="w-full max-w-[520px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xl"
      >
        <h2
          id="unplaced-title"
          className="text-[16px] font-semibold text-[var(--text-primary)]"
        >
          {final
            ? 'We cannot identify this file'
            : 'Tell us what this file shows'}
        </h2>
        <p className="mt-1 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
          {final
            ? `${item.reason}. It will not be saved. Upload a clearer copy or a different file.`
            : `${item.reason}. A few words will let the reader place it in the right container.`}
        </p>

        <div className="mt-3 flex min-h-[120px] items-center justify-center overflow-hidden rounded-[var(--r-sm)] border border-[var(--border-divider)] bg-[var(--bg-inset)]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="The file that could not be identified"
              className="max-h-[220px] w-auto object-contain"
            />
          ) : (
            <span className="px-3 text-center text-[12px] text-[var(--text-tertiary)]">
              {item.file.name}
            </span>
          )}
        </div>

        {!final ? (
          <>
            <label
              htmlFor="unplaced-words"
              className="mt-3 block text-[12.5px] font-medium text-[var(--text-primary)]"
            >
              What is it?
            </label>
            <textarea
              id="unplaced-words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="For example: the broken gate after the break-in, or my reloading bench."
              className="mt-1 w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-[10px] text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
            />
          </>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="min-h-[44px] rounded-[var(--r-sm)] px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:underline"
          >
            {final ? 'Delete this file' : 'Cancel'}
          </button>
          {!final ? (
            <button
              type="button"
              onClick={() => onRetry(words)}
              disabled={busy || !words.trim()}
              className="min-h-[44px] rounded-[var(--r-sm)] bg-[var(--red)] px-4 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Reading…' : 'Try again'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
