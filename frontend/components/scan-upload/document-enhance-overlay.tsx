'use client';

import type { DocShape as SiteDocShape } from '@/lib/scan/shapes';
import { UploadScanner, uploadDetector } from '@/components/scan-upload/document-scanner';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD'S CROPPER, REACHED WITH A FILE ALREADY IN HAND.
//
// This is the upload's own copy of the old enhance-overlay: the picked
// photo runs decode → find the document → perspective-crop it →
// straighten it → normalise the lighting → review → fix corners, and
// comes back as JPEGs. Nothing here is camera-specific.
//
// ⚠️ IT NO LONGER MOUNTS THE VENDORED SCANNER. It mounts UploadScanner,
// the upload's own trimmed fork, so the scanner under lib/scan-v3 stays
// exactly as upstream synced it. See lib/scan-upload/index.ts.
//
// ⚠️ THE DETECTOR MUST BE INJECTED. UploadScanner defaults to a
// NullDetector, which finds no outline and silently treats the whole
// frame as the page: every file would come back uncropped with no error
// anywhere. uploadDetector() is a module singleton that shares the
// scanner's model at /scan/v3/, so a second file reuses the loaded model.
//
// ⚠️ MOUNTED ONLY AFTER A FILE IS PICKED, AND THAT IS THE POINT. The
// detector and the ONNX runtime are ~19 MB; the whole reason this is a
// dynamic import is so nobody who is not uploading pays for them.
// ────────────────────────────────────────────────────────────────────

export interface EnhanceOverlayProps {
  files: File[];
  title: string;
  shape?: SiteDocShape;
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
}

/** The site's shapes include the green ID book; the cropper reads that one from the outline. */
function uploadShape(shape: SiteDocShape | undefined): 'card' | 'a4' | undefined {
  return shape === 'card' ? 'card' : shape === 'a4' ? 'a4' : undefined;
}

export default function EnhanceOverlay({ files, title, shape, onDone, onClose }: EnhanceOverlayProps) {
  return (
    <UploadScanner
      title={title}
      shape={uploadShape(shape)}
      documentName={title}
      detector={uploadDetector()}
      initialFiles={files}
      onDone={async (out) => {
        // Close either way: if the upload handler throws it shows its own
        // error, and a scanner left mounted keeps its canvas scratch alive.
        try {
          await onDone(out);
        } finally {
          onClose();
        }
      }}
      onClose={onClose}
    />
  );
}
