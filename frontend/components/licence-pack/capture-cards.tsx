'use client';

// ────────────────────────────────────────────────────────────────────
// THE TWO DOORS, AS THE MOCKUP DRAWS THEM.
//
// Not buttons at the bottom of a panel — two large cards side by side at the
// TOP of the step, because capture is the first thing a member should do and
// the design puts it first. The red one is primary and carries the QR glyph;
// the white one is the file they already have.
//
// Measurements read off the artboard: cards sit in a 2-column grid capped at
// 800px, ~15px/17px padding, 8px radius, the red one filled --red with white
// ink, the white one --bg-card with a --border keyline. Title 15px/600,
// subtitle 12.5px at 80% opacity on the red and --text-tertiary on the white.
//
// ⚠️ TWO DOORS, NEVER A THIRD. The server's CaptureRoute is 'qr' | 'upload'.
// No webcam, on any surface.
// ────────────────────────────────────────────────────────────────────

import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';

function QrIcon() {
  return (
    <svg
      width="22"
      height="22"
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

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export default function CaptureCards({
  motivationId,
  kind,
  title,
  subtitle,
  busy = false,
  onFiles,
  onArrived,
}: {
  motivationId: string;
  kind: string;
  /** What the scanner tells the member they are photographing. */
  title: string;
  subtitle?: string;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  onArrived?: (count: number) => void;
}) {
  return (
    <div className="grid max-w-[800px] grid-cols-1 gap-3.5 sm:grid-cols-2">
      {/* ⚠️ THE SCAN BUTTON IS WRAPPED, NOT RESTYLED. Its own chrome carries
          the hand-off logic, the device probe and the fallback picker; forking
          it to get the mockup's red fill would fork that behaviour too. The
          card is the surface, the component stays the control. */}
      <div className="gg-tile flex flex-col justify-between rounded-[var(--r-md)] bg-[var(--red)] px-[17px] py-[15px] text-white">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">
            <QrIcon />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-tight">
              Open the scanner on your phone
            </div>
            <div className="mt-1 text-[12.5px] leading-snug text-white/80">
              Scan the code — the better camera, and it lands here
            </div>
          </div>
        </div>

        <div className="mt-3 [&_button]:!border-white/40 [&_button]:!bg-white/10 [&_button]:!text-white">
          <ScanButton
            kind={kind}
            shape={shapeForKind(kind)}
            title={title}
            subtitle={subtitle}
            handoff={{ dest: 'motivation', motivationId }}
            onHandoffArrived={onArrived}
            onFiles={onFiles}
            disabled={busy}
            label="Show me the code"
            fallback={<span className="sr-only">Upload is offered beside this</span>}
          />
        </div>
      </div>

      <div className="gg-tile flex flex-col justify-between rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[17px] py-[15px]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
            <UploadIcon />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
              Upload a file
            </div>
            <div className="mt-1 text-[12.5px] leading-snug text-[var(--text-tertiary)]">
              A photo or a PDF you already have
            </div>
          </div>
        </div>

        <div className="mt-3">
          <FilePickerButton
            onFiles={onFiles}
            multiple
            disabled={busy}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-label={`Upload ${title}`}
          >
            Choose a file
          </FilePickerButton>
        </div>
      </div>
    </div>
  );
}
