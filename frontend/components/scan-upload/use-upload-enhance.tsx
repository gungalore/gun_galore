'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState, type ReactNode } from 'react';
import type { DocShape } from '@/lib/scan/shapes';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD'S TREATMENT, AS A HOOK, FOR PICKERS THAT OPEN THEIR OWN DIALOG.
//
// The upload's own copy of use-document-enhance. Several surfaces open
// the operating system's dialog from inside the member's tap (iOS Safari
// refuses a programmatic file dialog that is not attached to a gesture),
// so the pick happens on their own hidden <input>; this hook then runs
// exactly the same treatment on what comes back, through the upload's
// cropper rather than the vendored scanner.
//
// ⚠️ THE HEAVY LIFTING IS THE BROWSER'S, AND ONLY THE FIXED IMAGE IS SENT.
// The detector runs in a web worker (~19 MB of model and wasm fetched
// once, and only after a file is actually picked), the warp and the
// lighting normalisation run on a canvas in the page, and the server is
// handed a rectified JPEG.
//
// ⚠️ WITH THE FLAG OFF THIS IS A PASS-THROUGH, EXACTLY. NEXT_PUBLIC_SCANNER_V3
// is inlined at build time and is EMPTY in .env.example — production's
// resting state may well be "off" — so the off branch must hand the files
// to `onDone` untouched: no overlay, no asset fetch, no scanner UI.
// ────────────────────────────────────────────────────────────────────

const SCANNER_V3 = process.env.NEXT_PUBLIC_SCANNER_V3 === '1';

const EnhanceOverlay = dynamic(
  () => import('@/components/scan-upload/document-enhance-overlay'),
  { ssr: false },
);

/**
 * Is this a PDF, by the type or failing that by its name?
 *
 * ⚠️ MIRRORS `decodeFile` (lib/scan-upload/pipeline/decode.ts) EXACTLY,
 * name test included: a phone that hands over a PDF with an empty MIME
 * type still has to be read as a PDF there, or this and the cropper
 * disagree about the same file and one of them drops it.
 */
function isPdf(file: File): boolean {
  return (file.type || '') === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * Would the cropper's own `decodeFile` actually treat this as an image?
 *
 * ⚠️ THIS MUST MIRROR decode.ts, NOT APPROXIMATE IT. A PDF (by MIME or by
 * name) is `pdf`; a non-empty MIME that is not `image/*` is `unsupported`
 * without looking at the bytes; only then does it try to decode.
 *
 * ⚠️ THE DECODE IS THE REST OF THE TEST, AND IT IS THE HALF THAT MATTERS
 * MOST. A `.jpg` truncated in a download, a screenshot saved half-written,
 * or a PNG renamed to `.jpg` must pass through untouched rather than be
 * lost behind "We could not open that file".
 */
async function isImage(file: File): Promise<boolean> {
  const type = file.type || '';
  if (isPdf(file)) return false;
  if (type && !type.startsWith('image/')) return false;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    bitmap.close();
    return true;
  } catch {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      return true;
    } catch {
      return false;
    }
  }
}

export interface EnhanceRequest {
  /** What the picked files are, in the member's words. Titles the scanner. */
  title: string;
  /** Hint only — the cropper reads the real shape off the outline. */
  shape?: DocShape;
  /** Receives the rectified JPEGs, or the originals when nothing was enhanced. */
  onDone: (files: File[]) => void | Promise<void>;
}

export interface UploadEnhance {
  /** The review overlay, or null. Render it wherever the picker lives. */
  overlay: ReactNode;
  /**
   * Run the picked files through the cropper, then hand `req.onDone` the
   * result. Passes straight through when the flag is off.
   *
   * ⚠️ IT RESOLVES WHEN THE REQUEST IS DONE, AND THAT IS LOAD-BEARING FOR A
   * BATCH. The overlay is a single slot, so a caller filing several
   * documents must await one before starting the next — firing them all
   * off at once let every file after the first be overwritten here and
   * never handed to `onDone`. The promise settles on accept OR on close,
   * so a member who backs out does not stall whoever is waiting.
   */
  enhance: (files: File[], req: EnhanceRequest) => Promise<void>;
}

interface Pending {
  files: File[];
  req: EnhanceRequest;
  /** Resolves the promise `enhance` handed back. Idempotent. */
  settle: () => void;
}

export function useUploadEnhance(): UploadEnhance {
  const [pending, setPending] = useState<Pending | null>(null);

  const enhance = useCallback((files: File[], req: EnhanceRequest): Promise<void> => {
    if (!SCANNER_V3 || !files.length) {
      return Promise.resolve(req.onDone(files));
    }
    return new Promise<void>((resolve) => {
      void (async () => {
        const readable: File[] = [];
        const raw: File[] = [];
        for (const f of files) {
          (await isImage(f) ? readable : raw).push(f);
        }
        // Anything the browser cannot decode — a PDF, a HEIC on desktop, a
        // corrupt or renamed file — is handed on untouched rather than
        // disappearing behind "We could not open that file".
        if (raw.length) await req.onDone(raw);
        if (readable.length) setPending({ files: readable, req, settle: resolve });
        else resolve();
      })();
    });
  }, []);

  const overlay = pending ? (
    <EnhanceOverlay
      files={pending.files}
      title={pending.req.title}
      shape={pending.req.shape}
      // The overlay closes itself once onDone settles — see the finally in
      // document-enhance-overlay.tsx — so the state clears on either route.
      onDone={pending.req.onDone}
      // ⚠️ SETTLE ON CLOSE TOO, NOT ONLY ON DONE. The member can back out of
      // the cropper; without this the awaiting batch would wait for ever.
      onClose={() => {
        pending.settle();
        setPending(null);
      }}
    />
  ) : null;

  return { overlay, enhance };
}
