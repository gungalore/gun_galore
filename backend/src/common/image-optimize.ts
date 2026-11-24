import sharp from 'sharp';

/**
 * Longest edge we store for user photos (marketplace listings, community
 * posts, inquiry attachments).
 *
 * ⚠️ THIS IS A LATENCY GUARD, NOT A QUALITY CHOICE. On 2026-11-24 a 12 MP
 * iPhone photo (~2–3 MB) sent to Cloudinary stalled their upload/processing
 * for ~106 s, which is longer than nginx's 95 s `/api` timeout: the seller's
 * "Uploading photo 1 of 5" spinner ran into a 504 and the sell form rolled the
 * whole listing back. A 1920px JPEG is ~250–500 KB — an order of magnitude
 * less for Cloudinary to receive, transform and store — and is still larger
 * than any surface renders it. Keep this below the point where uploads can
 * approach the edge timeout.
 */
export const PHOTO_STORAGE_MAX_EDGE = 1920;

/** Re-encode when the photo is this big even if it is within the edge limit. */
const REENCODE_MIN_BYTES = 1_200_000;

/**
 * Shrink a photo that is about to be uploaded to Cloudinary.
 *
 * - Photos above 1920px on the longest side are downscaled (12 MP phone
 *   photos are ~4× the pixels for no visible gain on any page).
 * - Any photo over ~1.2 MB is re-encoded to JPEG so a huge PNG/filler file
 *   cannot ride through at full size.
 * - EXIF orientation is applied, and the re-encode drops EXIF metadata — so a
 *   seller's GPS coordinates do not travel with a listing photo.
 *
 * ⚠️ NEVER LETS THE OPTIMISER BLOCK AN UPLOAD. Anything sharp cannot read is
 * returned unchanged; the caller's own validation and the moderation screen
 * already ran. A photo that fails to shrink must still be uploadable.
 */
export async function optimizePhotoForUpload(bytes: Buffer): Promise<Buffer> {
  if (!bytes?.length) return bytes;
  try {
    const image = sharp(bytes, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return bytes;

    const longest = Math.max(meta.width, meta.height);
    if (
      longest <= PHOTO_STORAGE_MAX_EDGE &&
      bytes.length <= REENCODE_MIN_BYTES
    ) {
      return bytes;
    }

    const resized = image.resize({
      width: PHOTO_STORAGE_MAX_EDGE,
      height: PHOTO_STORAGE_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });

    // Keep transparency (logos, screenshots) as PNG; everything else becomes a
    // normal JPEG. A transparent PNG flattened to black is not acceptable on a
    // listing card.
    const out =
      meta.hasAlpha === true
        ? await resized.png({ compressionLevel: 9 }).toBuffer()
        : await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer();

    // Never hand back something bigger than what came in — a pathological
    // source would make the upload slower, not faster.
    return out.length > 0 && out.length < bytes.length ? out : bytes;
  } catch {
    return bytes;
  }
}
