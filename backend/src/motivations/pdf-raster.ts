import { execFile } from 'node:child_process';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// RUNNING THE PDF RASTERISER, OUT OF PROCESS.
//
// ⚠️ THE HELPER CAN CRASH THE PROCESS IT RUNS IN, WHICH IS THE WHOLE REASON IT
// IS A HELPER. See pdf-raster.child.ts: inside a booted Nest process the
// pdf.js/@napi-rs/canvas render has taken node down with an access violation,
// and no try/catch can see that. Everything that wants a PDF as an image —
// the C.I.P. inset and the annexure page images alike — goes through here, so
// the isolation is stated once rather than per caller.
// ────────────────────────────────────────────────────────────────────

/** How long the helper may take before it is killed. */
export const PDF_RASTER_TIMEOUT_MS = 30_000;

/**
 * How hard a C.I.P. datasheet is rasterised for the feature's inset.
 *
 * ⚠️ 4 IS CHOSEN, NOT DEFAULTED. It puts an A4 page at about 2 450 px wide;
 * set into an 82 mm column that is roughly 1 000 dpi, and the trimmed PNG runs
 * around 470 KB against packs that are already eleven megabytes. Lower and the
 * sheet's small type breaks up under a reader zooming in on it, which is the
 * whole reason it is on the page.
 */
export const CIP_INSET_SCALE = 4;

/**
 * How hard an uploaded annexure page is rasterised.
 *
 * ⚠️ LOWER THAN THE C.I.P. INSET, AND FOR SIZE RATHER THAN SHARPNESS. An inset
 * is one page that has to survive a reader zooming into a dimension table; an
 * annexure is up to eight pages of somebody's bank statement printed at full
 * content width, and at scale 4 a single pack gains several megabytes. At 3 an
 * A4 page is about 1 800 px wide — around 150 dpi, which keeps a serial number
 * and a municipal account number legible — for roughly a third of the bytes.
 */
export const ANNEXURE_PAGE_SCALE = 3;

/**
 * Rasterise every page of a PDF into `outDir` as `page-1.png` … and return how
 * many were written.
 *
 * ⚠️ A NON-ZERO EXIT IS THE EXPECTED FAILURE, NOT AN EXCEPTION. The helper
 * exists because the render can kill the process it runs in; when it does,
 * node exits with an access-violation status and no message. That is a failed
 * document, and the caller falls back — so the rejection carries the exit
 * status and whatever the helper managed to write to stderr.
 */
export function rasterisePdfToDir(
  inputPath: string,
  outDir: string,
  scale: number,
): Promise<number> {
  // ⚠️ THE COMPILED SIBLING, NOT THE SOURCE. `nest start --watch` runs from
  // dist/, so the helper is a .js beside this file at runtime.
  const script = path.join(__dirname, 'pdf-raster.child.js');
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, inputPath, outDir, String(scale)],
      { timeout: PDF_RASTER_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) {
          const match = /PAGES (\d+)/.exec(String(stdout ?? ''));
          const pages = match ? Number(match[1]) : 0;
          if (pages > 0) return resolve(pages);
          return reject(new Error('the rasteriser reported no pages written'));
        }
        const detail = String(stderr ?? '').trim();
        reject(new Error(`${err.message}${detail ? ` — ${detail}` : ''}`));
      },
    );
  });
}
