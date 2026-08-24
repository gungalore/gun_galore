'use client';

import { useId, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// A FILE PICKER THAT LOOKS LIKE THE REST OF THE SITE.
//
// A bare <input type="file"> renders the operating system's own "Choose file"
// button: light grey chrome with dark text, on a near-black page. It is the
// same class of complaint as the unreadable dropdowns — the browser painting
// its own widget in its own colour scheme, ignoring ours.
//
// So the input is hidden and a real button is labelled to it. Hidden with
// sr-only positioning rather than display:none, because display:none removes
// it from the accessibility tree and from form submission, and a keyboard user
// must still be able to reach it.
//
// ⚠️ THE INPUT IS NOT A DECORATION. Everything about the existing upload paths
// — accept, multiple, the onChange handler, clearing e.target.value so the same
// file re-fires — keeps working exactly as before. This component changes what
// the control LOOKS like and nothing about what it does.
// ────────────────────────────────────────────────────────────────────

export interface FilePickerButtonProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** The button's own words. */
  children?: React.ReactNode;
  /** Quieter treatment, for a secondary "add another" beside a primary. */
  variant?: 'primary' | 'secondary';
  /** Shown after a pick, so a member knows the file took. */
  showPicked?: boolean;
  /** Icon only. The surrounding row already says what is being added. */
  compact?: boolean;
  /**
   * Open the camera directly instead of a file chooser.
   *
   * ⚠️ ON A PHONE THIS IS THE WHOLE DIFFERENCE between "take a photo" and
   * "find a photo". 'environment' asks for the rear camera, which is the one
   * pointed at a target or a register page. Ignored by desktop browsers, which
   * fall back to the ordinary chooser — so it is safe to pass unconditionally.
   */
  capture?: 'environment' | 'user';
  /** Accessible name, required when compact leaves no visible words. */
  'aria-label'?: string;
  title?: string;
  className?: string;
  'aria-describedby'?: string;
}

export default function FilePickerButton({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  children,
  variant = 'secondary',
  showPicked = false,
  compact = false,
  capture,
  className,
  'aria-label': ariaLabel,
  title,
  'aria-describedby': describedBy,
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const id = useId();

  const base = compact
    ? 'inline-flex h-10 w-10 items-center justify-center rounded ' +
      'cursor-pointer disabled:cursor-default disabled:opacity-50'
    : 'inline-flex items-center gap-2 rounded px-3 py-2 text-sm ' +
      'min-h-[44px] cursor-pointer disabled:cursor-default disabled:opacity-50';
  const tone =
    variant === 'primary'
      ? 'bg-[var(--red)] text-white hover:bg-[var(--red-hover)]'
      : 'border border-[var(--border)] bg-[var(--bg-inset)] ' +
        'text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]';

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        aria-describedby={describedBy}
        // Off-screen, not display:none — the latter takes it out of the
        // accessibility tree, and the <label> below needs a real control.
        className="sr-only"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared FIRST, so re-picking the same file still fires onChange
          // even though the handler below may await.
          e.target.value = '';
          if (!files.length) return;
          if (showPicked) setPicked(files.map((f) => f.name));
          onFiles(files);
        }}
      />
      <label
        htmlFor={id}
        className={`${base} ${tone} ${className ?? ''} gg-datecell`}
        // A label is not focusable and does not fire on Enter. Both are
        // restored here so the control behaves like the button it looks like.
        tabIndex={disabled ? -1 : 0}
        role="button"
        // ⚠️ COMPACT LEAVES NO VISIBLE WORDS, so the accessible name has to
        // come from somewhere — without this the control announces as an
        // unlabelled button and the icon means nothing to a screen reader.
        aria-label={ariaLabel}
        title={title}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <PaperclipIcon />
        {!compact && (children ?? 'Choose a file')}
      </label>
      {showPicked && picked.length > 0 && (
        <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
          {picked.length === 1 ? picked[0] : `${picked.length} files chosen`}
        </p>
      )}
    </>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
