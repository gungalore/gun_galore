// ────────────────────────────────────────────────────────────────────
// TWO CARDS, ONE PAGE.
//
// ⚠️ THE OWNER SENDS TWO PHOTOGRAPHS AND WE HAND BACK ONE PAGE (2026-10-13).
// Operator: "If its two images that the owner just sent me and I need to upload
// them, they must get the scanner treatment in the background ... and put onto
// one fucking page." The front goes on top and the back below, on a single
// portrait sheet, so the filed document is one page rather than two.
//
// ⚠️ IT DRAWS THE ALREADY-POLISHED BYTES. The scanner treatment (warp,
// straighten, colour, crop, scale) has already run in `autoPolish`; this only
// arranges the two results. It must never be handed the raw picks.
//
// ⚠️ `fit` PER CARD, NEVER A STRETCH. Each card keeps its own aspect inside its
// own slot — a stretched licence card is a card whose serial reads wrong.
// ────────────────────────────────────────────────────────────────────

import { makeCanvas } from './pipeline/decode';

/** A4 portrait at roughly 200 dpi of content, small enough to upload quickly. */
const PAGE_W = 1400;
const PAGE_H = Math.round(PAGE_W * 1.4142);
const MARGIN = Math.round(PAGE_W * 0.06);

async function toBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function drawFit(
  ctx: CanvasRenderingContext2D,
  bmp: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / bmp.width, h / bmp.height);
  const dw = Math.max(1, Math.round(bmp.width * scale));
  const dh = Math.max(1, Math.round(bmp.height * scale));
  ctx.drawImage(bmp, x + Math.round((w - dw) / 2), y + Math.round((h - dh) / 2), dw, dh);
}

async function encode(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Compose the front and back of a licence card onto one portrait page.
 *
 * Throws only if the browser cannot decode one of the images; the caller falls
 * back to uploading them separately rather than losing them.
 */
export async function composeSides(front: File, back: File): Promise<File> {
  const [a, b] = await Promise.all([toBitmap(front), toBitmap(back)]);
  try {
    const canvas = makeCanvas(PAGE_W, PAGE_H);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    const contentW = PAGE_W - MARGIN * 2;
    const slotH = Math.floor((PAGE_H - MARGIN * 3) / 2);
    // Front on top, back below. Operator, 2026-10-13.
    drawFit(ctx, a, MARGIN, MARGIN, contentW, slotH);
    drawFit(ctx, b, MARGIN, MARGIN * 2 + slotH, contentW, slotH);

    const blob = await encode(canvas, 0.9);
    return new File([blob], 'licence-card.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    a.close();
    b.close();
  }
}
