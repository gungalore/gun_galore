'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { DocShape } from '@/lib/scan/shapes';

// ────────────────────────────────────────────────────────────────────
// THE WAY IN TO THE SCANNER.
//
// Light on purpose: it probes for a usable camera, renders one button, and
// pulls the scanner itself in only when that button is pressed. The detector,
// the warp and the enhancement are a few tens of kilobytes that nobody who
// picks a file from their phone should ever download.
//
// ⚠️ THE FILE PICKER IS NEVER REPLACED, ONLY JOINED. Every reason the camera
// can fail is a reason somebody still needs to upload a document: permission
// refused, an in-app browser that denies getUserMedia silently, an iPhone
// running an older iOS in standalone mode, a desktop with no camera, or a
// member who was sent a PDF by their association. `fallback` is required by
// the type for exactly that reason — there is no configuration of this
// component in which the picker is absent.
// ────────────────────────────────────────────────────────────────────

const DocumentScanner = dynamic(() => import('./document-scanner'), {
  ssr: false,
});

export interface ScanButtonProps {
  /**
   * What the member is most likely holding — usually `shapeForKind(kind)`.
   * Sets the starting guide only; they can change it on screen.
   */
  shape?: DocShape;
  /** Names the scanner to a screen reader. */
  title: string;
  onFiles: (files: File[]) => void | Promise<void>;
  /** The plain picker, rendered beside this and ALONE when there is no camera. */
  fallback: React.ReactNode;
  disabled?: boolean;
  label?: string;
}

export default function ScanButton({
  shape = 'any',
  title,
  onFiles,
  fallback,
  disabled = false,
  label = 'Take a photo',
}: ScanButtonProps) {
  const [open, setOpen] = useState(false);
  // null while we do not know yet. Rendering the button and then removing it
  // would be a control vanishing under a thumb.
  const [usable, setUsable] = useState<boolean | null>(null);

  useEffect(() => {
    // A capability probe, not a permission request. enumerateDevices does not
    // prompt; asking for the stream would, and prompting before the member has
    // said they want the camera is how a site loses that permission for good.
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (alive) setUsable(false);
          return;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) setUsable(devices.some((d) => d.kind === 'videoinput'));
      } catch {
        if (alive) setUsable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {usable && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="gg-datecell inline-flex min-h-[44px] items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-inset)',
            color: 'var(--text-primary)',
          }}
        >
          <CameraIcon />
          {label}
        </button>
      )}

      {/* The picker is always here, and always first in the DOM: a member who
          cannot see the screen reaches the path that does not need sight. */}
      {fallback}

      {open && (
        <DocumentScanner
          shape={shape}
          title={title}
          onDone={onFiles}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A2.5 2.5 0 015.5 6h1.7l1.2-2h7.2l1.2 2h1.7A2.5 2.5 0 0121 8.5v9A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
