import sharp from 'sharp';

// ────────────────────────────────────────────────────────────────────
// UPRIGHT PIXELS, OR THE ORIGINAL BYTES — NEVER ANYTHING ELSE.
//
// An iPhone holds the sensor landscape and stores a portrait photograph as
// landscape pixels plus an EXIF Orientation tag. Whoever renders it must apply
// that tag: the browser does, `sharp().rotate()` does, and the vision model MAY
// NOT. The vault used to hand the raw upload to the model and store it raw, so
// a portrait licence could reach the classifier lying on its side, and every
// read (kind, dates, serials) was taken off a sideways page.
//
// This bakes the orientation into the pixels once, at ingest, so the model, the
// stored copy and every later reader all see the same upright image.
//
// ⚠️ IT TOUCHES NOTHING WHEN THERE IS NOTHING TO FIX, AND NEVER THROWS. An
// image with no orientation tag, a PDF, a format sharp cannot decode, or any
// error at all returns the ORIGINAL bytes and mime unchanged — an upload must
// still be filed even if the correction cannot run. Only a real, non-default
// Orientation tag triggers a re-encode, and then only a rotation: no resize, no
// crop, no colour change, so an evidence photograph is turned upright and not
// otherwise altered.
//
// ⚠️ A RE-ENCODE MEANS JPEG. Orientation tags live on JPEG/PNG/WebP; when one
// needs applying the result is written as a high-quality JPEG and the caller
// must STORE AND CLASSIFY WITH THE RETURNED MIME, not the upload's. `rotated`
// says which happened, for the ledger and for tests.
// ────────────────────────────────────────────────────────────────────

export interface UprightBytes {
  bytes: Buffer;
  mimeType: string;
  rotated: boolean;
}

const ORIENTABLE = /^image\/(jpeg|png|webp)$/;

export async function uprightImageBytes(
  bytes: Buffer,
  mimeType: string,
): Promise<UprightBytes> {
  if (!bytes?.length || !ORIENTABLE.test(mimeType)) {
    return { bytes, mimeType, rotated: false };
  }
  try {
    const meta = await sharp(bytes).metadata();
    // 1 is "already upright"; undefined means no tag at all. Both are a no-op.
    if (!meta.orientation || meta.orientation === 1) {
      return { bytes, mimeType, rotated: false };
    }
    const out = await sharp(bytes)
      .rotate()
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    return { bytes: out, mimeType: 'image/jpeg', rotated: true };
  } catch {
    return { bytes, mimeType, rotated: false };
  }
}
