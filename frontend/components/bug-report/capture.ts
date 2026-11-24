import { toBlob } from 'html-to-image';

// Best-effort screenshot of the CURRENT page, taken the moment the report
// sheet opens so the capture shows what the member was actually looking at.
//
// ⚠️ IT NEVER THROWS. Cross-origin images taint the canvas, some WebGL/3D
// scenes cannot be serialised, and a very long page can blow past the size
// budget — all normal. Every one of those returns null and the report simply
// goes without a screenshot. A failed capture is not a failed report.
//
// The report sheet carries data-bug-report-skip and is filtered out of the
// clone, so capturing while the sheet is open still shows the page behind it.

const MAX_BYTES = 6 * 1024 * 1024;

export function currentPageUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}

function toFile(blob: Blob): File {
  return new File([blob], `bug-${Date.now()}.jpg`, { type: 'image/jpeg' });
}

// Target size for the attachment. The email path used to carry multi-megabyte
// screenshots; on a phone that upload can lose the connection (Safari's bare
// "Load failed", 2026-11-24). A report only needs to show the problem, so the
// capture is downscaled to this width and re-encoded.
const TARGET_WIDTH = 900;
const TARGET_QUALITY = 0.55;
const MAX_UPLOAD_BYTES = 1_500_000;

async function shrink(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', TARGET_QUALITY),
    );
    if (!out || out.size > MAX_UPLOAD_BYTES) return null;
    return out;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function capture(): Promise<File | null> {
  if (typeof document === 'undefined') return null;
  const target = document.documentElement;
  const bg =
    getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';

  // Two tries: a decent one, then a much smaller one, before giving up.
  const attempts = [
    { quality: 0.6, pixelRatio: 0.8 },
    { quality: 0.4, pixelRatio: 0.5 },
  ];

  for (const attempt of attempts) {
    try {
      const blob = await toBlob(target, {
        quality: attempt.quality,
        pixelRatio: attempt.pixelRatio,
        backgroundColor: bg,
        cacheBust: true,
        filter: (node) =>
          !(
            node instanceof HTMLElement &&
            node.dataset?.bugReportSkip === 'true'
          ),
      });
      if (!blob) continue;
      if (blob.size > MAX_BYTES) continue;
      const small = await shrink(blob);
      if (!small) continue;
      return toFile(small);
    } catch {
      // Tainted canvas / unserialisable node — try the smaller attempt.
    }
  }
  return null;
}

export async function capturePageScreenshot(): Promise<File | null> {
  // A report must never wait on a screenshot: long pages used to freeze this
  // for many seconds. Past 8 seconds we send the report without one.
  return withTimeout(capture(), 8_000);
}
