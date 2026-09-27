'use client';

import FilePickerButton from '@/components/file-picker-button';
import type { DocShape } from '@/lib/scan/shapes';
import { useUploadEnhance } from './use-upload-enhance';

// ────────────────────────────────────────────────────────────────────
// THE PLAIN PICKER, WITH THE CROPPER'S OWN TREATMENT BEHIND IT.
//
// A document photographed by hand and uploaded straight from the gallery
// used to reach the vault RAW: the desk still in frame, the page at an
// angle, a shadow across the bottom, yellow paper under indoor light. The
// camera path has always fixed all of that — detect the outline, warp the
// page flat, turn it upright, divide the lighting out — but the file
// picker never touched it.
//
// So: same button, same look, same `onFiles(files)` contract. What changes
// is that the picked photo goes through the upload's own cropper before it
// is handed on. The member sees the crop, can drag the corners if the
// detector misread them, and picks a look.
//
// ⚠️ THIS IS THE UPLOAD'S OWN COPY, NOT THE SCANNER'S. It points at the
// upload's tree (use-upload-enhance → document-enhance-overlay →
// document-scanner → lib/scan-upload). The vendored scanner under
// lib/scan-v3 and components/scan-v3 is never mounted from here.
//
// ⚠️ THE FILE IS PICKED HERE, NOT INSIDE THE OVERLAY, AND THAT IS DELIBERATE.
// iOS Safari refuses a file dialog that is not attached to a gesture, so
// keeping the pick on the visible button means one chooser, opened by a
// real tap, and the files are fed in as `initialFiles` instead.
//
// ⚠️ AND NOTHING IS DOWNLOADED UNTIL A FILE IS PICKED. The hook's dynamic
// import keeps the cropper — and the ~19 MB detector and ONNX runtime it
// fetches — out of the page's bundle.
//
// ⚠️ WITH THE FLAG OFF THIS IS THE OLD PICKER, EXACTLY. NEXT_PUBLIC_SCANNER_V3
// is inlined at build time and is EMPTY in .env.example, so the off branch
// is today's behaviour: raw files straight to onFiles, no overlay, no
// asset fetch, no cropper UI at all.
// ────────────────────────────────────────────────────────────────────

export interface DocumentEnhancerProps {
  onFiles: (files: File[]) => void;
  /** Already-resolved MIME types, e.g. 'image/jpeg,image/png,application/pdf'. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** The button's own words. */
  children?: React.ReactNode;
  /** Quieter treatment, for a secondary "add another" beside a primary. */
  variant?: 'primary' | 'secondary';
  /** Icon only; the surrounding row already says what is being added. */
  compact?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Titles the cropper and names the produced files. */
  title: string;
  /** Hint only — the cropper reads the real shape off the outline. */
  shape?: DocShape;
}

export default function DocumentEnhancer({
  onFiles,
  accept,
  multiple,
  disabled,
  children,
  variant,
  compact,
  className,
  'aria-label': ariaLabel,
  title,
  shape,
}: DocumentEnhancerProps) {
  const { overlay, enhance } = useUploadEnhance();

  return (
    <>
      <FilePickerButton
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        variant={variant}
        compact={compact}
        className={className}
        aria-label={ariaLabel}
        // ⚠️ `capture` is deliberately NOT forwarded. It opens the camera
        // directly, which would skip the overlay entirely and hand back an
        // unenhanced photo — the very thing this component exists to fix.
        onFiles={(f) => void enhance(f, { title, shape, onDone: onFiles })}
      >
        {children}
      </FilePickerButton>
      {overlay}
    </>
  );
}
