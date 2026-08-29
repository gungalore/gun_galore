'use client';

// ────────────────────────────────────────────────────────────────────
// THE TWO DOORS. Scan by phone, or upload.
//
// ⚠️ TWO, NOT FOUR, AND NEVER A WEBCAM. The earlier capture design drew four
// doors and the handoff spec still says "the four doors"; both are stale
// against the operator's 2026-08-28 decision and against the server, whose
// CaptureRoute type is exactly 'qr' | 'upload'. Do not add a camera button.
//
// Styling is the mockup's (Main.dc.html, step 7): a red-filled primary button
// carrying a QR glyph and the words "Open the scanner on your phone", with the
// upload offered underneath in a quieter line rather than as a second button
// competing with it. On a phone the scanner opens in place; on a desktop it
// hands off to the member's own phone by QR, which is the whole point — the
// camera they have is better than the one they are sitting at.
//
// ⚠️ THE ICON IS INLINE SVG, NOT AN EMOJI. The artboards use 📷 📱 ⬆️ as
// placeholders and the house rule is SVG: emoji render differently on every
// platform and one of these sits on a red fill where a colour emoji is
// unreadable.
// ────────────────────────────────────────────────────────────────────

import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';

/** The QR glyph from the mockup, redrawn at 17px on currentColor. */
function QrIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M20 14v3" />
      <path d="M17 20h4" />
    </svg>
  );
}

export default function CaptureRoutes({
  motivationId,
  kind,
  title,
  subtitle,
  busy = false,
  onFiles,
  onArrived,
}: {
  motivationId: string;
  /** The MotivationUploadKind this row collects. */
  kind: string;
  /** What the scanner tells the member they are photographing. */
  title: string;
  subtitle?: string;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  /** Fired when a hand-off finishes on the phone, so the page can re-read. */
  onArrived?: (count: number) => void;
}) {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2">
      <ScanButton
        kind={kind}
        shape={shapeForKind(kind)}
        title={title}
        subtitle={subtitle}
        // ⚠️ THE HAND-OFF IS THE POINT ON DESKTOP. Without it the button
        // offers a webcam, which is the door that was removed.
        handoff={{ dest: 'motivation', motivationId }}
        onHandoffArrived={onArrived}
        onFiles={onFiles}
        disabled={busy}
        label="Open the scanner on your phone"
        // ⚠️ REQUIRED BY THE TYPE, AND THAT IS DELIBERATE — see the component's
        // own header: "there is no configuration of this component in which
        // the picker is absent". A member whose association emailed them a PDF
        // has nothing to photograph.
        fallback={
          <FilePickerButton
            onFiles={onFiles}
            multiple
            disabled={busy}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-label={`Upload ${title}`}
          >
            Upload
          </FilePickerButton>
        }
      />
    </div>
  );
}
