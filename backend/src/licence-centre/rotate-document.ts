import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';

// ────────────────────────────────────────────────────────────────────
// A DOCUMENT TURNED A QUARTER TURN, FOR GOOD.
//
// ⚠️ THIS IS NOT uprightImageBytes, AND THE TWO MUST NOT BE CONFUSED.
// uprightImageBytes reads an EXIF Orientation tag and bakes it into the pixels
// once, at ingest. It only fires when the camera WROTE the tag, and it knows
// nothing about which way is up in the picture itself — an iPhone that stores
// landscape pixels with no tag sails straight through it. This one turns the
// pixels by a fixed amount because a member looked at the page and said "that
// is on its side". They answer different questions.
//
// ⚠️ AN IMAGE BECOMES JPEG, AND THE CALLER MUST STORE THE RETURNED MIME. The
// same rule as upright-image.ts, for the same reason: a rotation is a decode
// and a re-encode, so what comes back is not a PNG any more even if a PNG went
// in. Alpha is flattened onto white first, because a JPEG has nowhere to put it
// and sharp's default composite is black — a black page behind a scan.
//
// ⚠️ A PDF IS TURNED, NOT RASTERISED. Each page's /Rotate is adjusted, which is
// lossless: the text stays text, the file stays a PDF, and a multipage document
// keeps every page. Rasterising here would spend the print renderer and hand
// back images we cannot store as a PDF credential.
//
// ⚠️ ANYTHING ELSE THROWS, AND THE CALLER MUST NOT STORE. A rotation we could
// not perform is not a rotation to half-apply.
// ────────────────────────────────────────────────────────────────────

export interface RotatedBytes {
  bytes: Buffer;
  mimeType: string;
}

const IMAGE = /^image\/(jpeg|png|webp)$/;

/** Normalise any integer of quarter turns into 0..3, so -1 is the same as 3. */
function quarterTurns(turns: number): number {
  return ((Math.trunc(turns) % 4) + 4) % 4;
}

/**
 * Turn a stored document by `turns` quarter turns clockwise.
 *
 * Returned bytes and mime are what the caller writes back. `turns` of 0 (or any
 * multiple of four) is a byte-for-byte no-op, so a caller that already settled
 * on the direction never rewrites a file for nothing.
 */
export async function rotateDocumentBytes(
  bytes: Buffer,
  mimeType: string,
  turns: number,
): Promise<RotatedBytes> {
  const t = quarterTurns(turns);
  if (t === 0) return { bytes, mimeType };

  if (mimeType === 'application/pdf') {
    const pdf = await PDFDocument.load(bytes);
    for (const page of pdf.getPages()) {
      page.setRotation(degrees((page.getRotation().angle + t * 90) % 360));
    }
    return { bytes: Buffer.from(await pdf.save()), mimeType: 'application/pdf' };
  }

  if (IMAGE.test(mimeType)) {
    const out = await sharp(bytes)
      .rotate(t * 90)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    return { bytes: out, mimeType: 'image/jpeg' };
  }

  throw new Error('This file type cannot be rotated.');
}
