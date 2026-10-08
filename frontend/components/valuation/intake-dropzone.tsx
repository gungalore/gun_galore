'use client';

import { useRef, useState } from 'react';

/**
 * Desktop photo intake: drag-and-drop or click-to-pick. Files are handed to
 * the caller, which uploads them one at a time so the server can strip EXIF
 * and enforce the slot limit authoritatively.
 */
export function IntakeDropzone({
  onFiles,
  disabled,
  remaining,
}: {
  onFiles: (files: File[]) => void;
  disabled: boolean;
  remaining: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function take(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (files.length) onFiles(files.slice(0, Math.max(0, remaining)));
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className="flex flex-col items-center justify-center text-center rounded-[10px] py-10 px-4"
      style={{
        border: `1px dashed ${dragOver ? 'var(--red)' : 'var(--border)'}`,
        background: dragOver ? 'rgba(227,6,19,0.04)' : 'var(--bg-inset)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-tertiary)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
      <p className="mt-3 text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        Drag photos here, or click to choose
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        JPG, PNG, WEBP or HEIC, up to 10MB each, {remaining} slot
        {remaining === 1 ? '' : 's'} left
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
