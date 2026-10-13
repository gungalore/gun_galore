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

export async function capturePageScreenshot(): Promise<File | null> {
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
      return toFile(blob);
    } catch {
      // Tainted canvas / unserialisable node — try the smaller attempt.
    }
  }
  return null;
}
