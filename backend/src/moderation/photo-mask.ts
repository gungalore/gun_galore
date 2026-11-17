// Server-side masking. The detector returns normalized rectangles on the
// EXIF-upright image; this turns every one of them into an irreversible
// pixelated block in a single re-encode. Pixelation rather than a Gaussian
// blur: text and QR codes stay recoverable from a mild blur, not from a
// mosaic whose blocks are roughly an eighth of the region's short side.

import sharp from 'sharp';
import type { PhotoBox } from './jev-image-battery';

/** Grow each box slightly so anti-aliased edges are covered too. */
const PAD = 0.01;

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

    // A 6px minimum block keeps a small phone number from surviving as a
    // legible smudge; an eighth-of-the-short-side block destroys a QR.
    const block = Math.max(6, Math.round(Math.min(regionWidth, regionHeight) / 8));
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
