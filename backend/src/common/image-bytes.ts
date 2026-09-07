import sharp from 'sharp';

// ────────────────────────────────────────────────────────────────────
// THE SIZE AN UPLOADED IMAGE IS SENT TO THE MODEL AT.
//
// image-url.ts bounds a Cloudinary URL; this bounds BYTES we already hold
// — a multipart upload that never went through Cloudinary. Same reason:
// the model reads 768-pixel tiles and bills per tile, so a 12-megapixel
// phone photograph costs several times the tokens of a 1280-pixel copy
// and reads no better. The Sell page's identify-from-photos posts raw
// camera output; bounding it here is the only place that can.
//
// EXIF orientation is applied (`rotate()` with no argument) so a portrait
// photograph is not handed to the model lying on its side, and the result
// is always JPEG so the mime type the caller sends is true.
//
// ⚠️ NEVER FAILS THE CALL. If sharp cannot read the bytes (a HEIC the
// build does not decode, a truncated file), the original goes through
// unchanged and the model gets its chance — a resize is a saving, not a
// gate.
// ────────────────────────────────────────────────────────────────────

export interface BoundedImage {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** True when the bytes were re-encoded; false when the original stands. */
  bounded: boolean;
}

export async function boundedImageBytes(
  input: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' },
  maxEdge: number,
): Promise<BoundedImage> {
  try {
    const buf = Buffer.from(input.base64, 'base64');
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    // Already within bounds and already JPEG: nothing to gain from a
    // re-encode, and re-encoding a JPEG loses a little every time.
    if (w && h && Math.max(w, h) <= maxEdge && input.mimeType === 'image/jpeg') {
      return { ...input, bounded: false };
    }
    const out = await sharp(buf)
      .rotate()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { base64: out.toString('base64'), mimeType: 'image/jpeg', bounded: true };
  } catch {
    return { ...input, bounded: false };
  }
}
