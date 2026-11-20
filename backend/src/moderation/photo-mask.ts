// Server-side masking. The detector returns normalized rectangles on the
// EXIF-upright image; this turns every one of them into an irreversible
// pixelated block in a single re-encode. Pixelation rather than a Gaussian
// blur: text and QR codes stay recoverable from a mild blur, not from a
// mosaic whose blocks are roughly an eighth of the region's short side.

import sharp from 'sharp';
import type { PhotoBox } from './jev-image-battery';

/**
 * Grow each box slightly so anti-aliased edges are covered too.
 *
 * ⚠️ SMALL ON PURPOSE. At 1% a box that ended at a URL's baseline reached up
 * into the brand wordmark printed directly above it, so the mask swallowed
 * "PRIMER" along with the URL. At 0.3% the pad still covers the ascenders the
 * detector's box can clip, without reaching the wordmark's baseline. The
 * detector is asked for a tight box; this pad covers anti-aliasing, not model
 * slop.
 */
const PAD = 0.003;

export async function maskPhotoRegions(
  bytes: Buffer,
  boxes: readonly PhotoBox[],
): Promise<Buffer | null> {
  if (!boxes.length) return null;

  const upright = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const meta = await sharp(upright).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return null;

  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (const box of boxes) {
    const left = Math.max(0, Math.floor((box.left - PAD) * width));
    const top = Math.max(0, Math.floor((box.top - PAD) * height));
    const right = Math.min(width, Math.ceil((box.right + PAD) * width));
    const bottom = Math.min(height, Math.ceil((box.bottom + PAD) * height));
    const regionWidth = right - left;
    const regionHeight = bottom - top;
    if (regionWidth < 2 || regionHeight < 2) continue;

    const region = await sharp(upright)
      .extract({
        left,
        top,
        width: regionWidth,
        height: regionHeight,
      })
      .toBuffer();

    // ⚠️ THE BLOCK MUST BE TALL ENOUGH TO DESTROY A LINE OF TEXT. An
    // eighth-of-the-short-side block left a short URL readable as a row of
    // letter shapes once the detector returned a tight, one-line box (the
    // earlier loose box was tall enough to survive). A third of the region's
    // height gives a three-row mosaic: the glyphs are gone, but it still looks
    // like redaction rather than a painted bar. It also destroys a QR.
    const block = Math.max(6, Math.round(regionHeight / 3));
    const smallWidth = Math.max(1, Math.round(regionWidth / block));
    const smallHeight = Math.max(1, Math.round(regionHeight / block));

    // ⚠️ TWO PIPELINES, NOT TWO .resize() CALLS ON ONE. Sharp keeps only the
    // last resize in a single pipeline, so `sharp(region).resize(small).resize(full)`
    // silently returned the original region and the mask did nothing. The small
    // copy has to be a real buffer before it is blown back up.
    const small = await sharp(region)
      .resize({
        width: smallWidth,
        height: smallHeight,
        fit: 'fill',
        kernel: 'nearest',
      })
      .toBuffer();

    const pixelated = await sharp(small)
      .resize({
        width: regionWidth,
        height: regionHeight,
        fit: 'fill',
        kernel: 'nearest',
      })
      .toBuffer();

    composites.push({ input: pixelated, left, top });
  }

  if (!composites.length) return null;

  return sharp(upright)
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();
}
