// ────────────────────────────────────────────────────────────────────
// WHAT A FILE ACTUALLY IS, READ FROM ITS FIRST FEW BYTES.
//
// ⚠️ THE DECLARED TYPE IS A CLAIM, NOT A FACT. `file.mimetype` is whatever the
// browser said, and a file extension is whatever somebody typed — the KYC
// upload path already distrusted both enough to check for '%PDF-' by hand
// before deciding whether to store a document as raw or as an image.
//
// It matters more than it looks. The stored type is what an authenticated
// download route serves and what is sent to Claude as the `media_type` on a
// vision block, so a wrong value is a document that will not open in a browser
// and a scan that comes back refused.
//
// Only the four types the uploaders accept are recognised — jpeg, png, webp
// and pdf. Anything else falls back to the caller's guess rather than being
// rejected here: this answers a question, it does not police the upload.
//
// PURE — no Nest, no I/O.
// ────────────────────────────────────────────────────────────────────

/**
 * @param b        the file's opening bytes (the whole buffer is fine)
 * @param fallback returned when nothing is recognised
 */
export function sniffMime(b: Buffer, fallback = 'image/jpeg'): string {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  // SOI marker. Every JPEG starts FF D8, whatever follows.
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  // 89 'P' 'N' 'G'.
  if (
    b.length >= 4 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  ) {
    return 'image/png';
  }
  // RIFF....WEBP — the size field sits between the two, so both are checked.
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return fallback;
}

/** Is this something Claude can read as an image block? */
export function isVisionImage(mime: string): boolean {
  return (
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    mime === 'image/gif'
  );
}
