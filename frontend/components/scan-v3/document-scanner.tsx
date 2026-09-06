'use client';

import { useMemo } from 'react';
import { DocumentScanner as Scanner, WorkerDetector } from '@/lib/scan-v3';
import type { DocShape } from '@/lib/scan/shapes';
import type { Quad, Rect } from '@/lib/scan/geometry';
import '@/lib/scan-v3/ui/scanner.css';

// ────────────────────────────────────────────────────────────────────
// THE NEW SCANNER, BEHIND THE OLD DOOR.
//
// Same props as components/scan/document-scanner.tsx, so ScanButton and the
// phone hand-off page swap one dynamic import for another and nothing else
// moves. The scanner itself lives in lib/scan-v3 (copied from the standalone
// repo by its sync script; never edited here).
//
// What is different for the member: no "what are you holding?" chooser. The
// scanner finds the document, reads its proportions to tell a card from a
// page, straightens and cleans it, and only fires the shutter when the print
// is in focus. `shape` is a hint at most; `skipChoose` and `staticAim` have
// nothing to act on and are accepted so callers need not change.
//
// `detect` (the server-assisted fallback the old scanner used on a weak
// signal) is accepted and ignored: detection runs on the phone, in a worker,
// from assets under /scan/v3/.
// ────────────────────────────────────────────────────────────────────

export interface DocumentScannerProps {
  detect?: (
    frame: Blob,
    priors: { aim?: Rect; expectAspect?: number },
  ) => Promise<{ quad: Quad; minConfidence: number; ms?: number } | null>;
  shape?: DocShape;
  multiDefault?: boolean;
  skipChoose?: boolean;
  staticAim?: boolean;
  title: string;
  subtitle?: string;
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
}

/** Where the model and the ONNX runtime live. Kept out of the service worker's precache (next.config.mjs). */
export const SCAN_V3_ASSETS = '/scan/v3/';

let shared: WorkerDetector | null = null;

/**
 * One detector per page: the worker and its 5 MB model are loaded once and
 * kept, so opening the scanner a second time in a session is instant.
 */
export function scanDetector(): WorkerDetector {
  if (!shared) {
    shared = new WorkerDetector({
      modelUrl: SCAN_V3_ASSETS + 'docaligner-lcnet100.onnx',
      wasmPaths: SCAN_V3_ASSETS,
      name: 'docaligner-lcnet100',
    });
  }
  return shared;
}

export default function DocumentScanner({
  shape,
  multiDefault = false,
  title,
  subtitle,
  onDone,
  onClose,
}: DocumentScannerProps) {
  const detector = useMemo(scanDetector, []);
  return (
    <Scanner
      title={title}
      subtitle={subtitle}
      // The site's shapes include the ID book; the scanner reads that one from the outline.
      shape={shape === 'card' ? 'card' : shape === 'a4' ? 'a4' : undefined}
      multiDefault={multiDefault}
      // The member has already pressed "Take a photo": straight to the camera.
      // The scanner's own start screen (camera or photos) is still where a
      // blocked camera lands them.
      autoStart="camera"
      detector={detector}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
