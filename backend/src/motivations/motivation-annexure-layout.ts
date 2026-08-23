// ────────────────────────────────────────────────────────────────────
// LAYING THE SCANNED DOCUMENTS OUT AS ANNEXURE PAGES.
//
// The applicant walks into the DFO's office with the motivation, the
// annexures, and the originals. Everything gets certified in one sitting —
// which only works if the copies are IN the pack, printed at a size a
// commissioner of oaths will stamp and a DFO will read.
//
// ⚠️ EVERY COPY IS NAMED. A page of unlabelled photographs is a page somebody
// has to match against the index by eye, and a DFO who cannot tell which
// annexure a copy belongs to is a DFO who asks for the pack again. Each image
// carries its annexure letter and the document's name above it.
//
// ⚠️ AS MANY PER PAGE AS FIT AT FULL WIDTH — never more, never shrunk to make
// one more fit. Every image is drawn at the full content width unless the
// page height stops it, so an A4 certificate takes a page to itself and two
// licence cards share one. Packing tighter would mean scaling down, and a
// copy nobody can read is not a copy: it is paper.
//
// Pure. No pdfkit, no Buffer decoding beyond a header parse, so the packing
// rules can be tested as arithmetic.
// ────────────────────────────────────────────────────────────────────

export interface AnnexureImage {
  /** 'A', 'B' … from the annexure index. Shared by copies of one kind. */
  letter: string;
  /** The document's name, in the member's words. */
  label: string;
  /** 1-based, when one annexure letter has several copies. */
  index: number;
  total: number;
  width: number;
  height: number;
  /**
   * Reserve a certification block under this copy.
   *
   * ⚠️ SPACE THE STAMP CAN LAND ON, RESERVED BEFORE THE IMAGE IS PLACED. A
   * commissioner's stamp is about 40 mm across and it goes on the copy — so
   * on a page packed edge to edge there is nowhere for it to go that is not
   * on top of somebody's ID number. Reserving the strip here, in the pure
   * planner, means the image is sized to leave room rather than the block
   * being drawn over it afterwards and hoping.
   */
  stamp?: boolean;
}

export interface PlacedImage extends AnnexureImage {
  /** Top-left of the image, in PDF points from the page's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Baseline box for the caption, directly above the image. */
  captionY: number;
  /** Top of the reserved certification block, when one was asked for. */
  stampY?: number;
}

export interface LayoutBox {
  /** Content area, excluding margins. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Height reserved for the caption above each image, in points. */
export const CAPTION_H = 16;
/** Gap between one image and the next caption on the same page. */
export const GAP = 18;
/**
 * Height reserved under a copy for the certification block, in points.
 *
 * 92pt ≈ 32 mm — enough for a 40 mm round stamp to sit in and still leave the
 * signature and date rules readable beside it. Bigger and a full-page A4
 * certificate stops fitting on one page; smaller and the stamp overhangs onto
 * the copy, which is exactly what the reservation exists to prevent.
 */
export const STAMP_H = 92;

/**
 * Pack images onto pages.
 *
 * @returns one array of placements per page, in order.
 */
export function planAnnexurePages(
  images: AnnexureImage[],
  box: LayoutBox,
): PlacedImage[][] {
  const pages: PlacedImage[][] = [];
  let page: PlacedImage[] = [];
  let cursor = box.y;

  for (const img of images) {
    // Full content width, unless that makes it taller than a whole page.
    const ratio = img.width > 0 && img.height > 0 ? img.height / img.width : 1;
    const stampH = img.stamp ? STAMP_H : 0;
    let w = box.width;
    let h = w * ratio;
    const maxH = box.height - CAPTION_H - stampH;
    if (h > maxH) {
      h = maxH;
      w = ratio > 0 ? h / ratio : box.width;
    }

    const need = CAPTION_H + h + stampH;
    const used = cursor - box.y;
    // ⚠️ THE FIRST IMAGE NEVER BREAKS. Without this a single image taller
    // than the box would loop forever pushing itself to a fresh page.
    if (page.length > 0 && used + GAP + need > box.height) {
      pages.push(page);
      page = [];
      cursor = box.y;
    }
    if (page.length > 0) cursor += GAP;

    page.push({
      ...img,
      captionY: cursor,
      // Centred horizontally, which matters for the height-limited case where
      // the image is narrower than the content area.
      x: box.x + (box.width - w) / 2,
      y: cursor + CAPTION_H,
      w,
      h,
      ...(img.stamp ? { stampY: cursor + CAPTION_H + h + 8 } : {}),
    });
    cursor += need;
  }

  if (page.length > 0) pages.push(page);
  return pages;
}

/**
 * The caption printed above one copy.
 *
 * ⚠️ "(2 of 4)" IS ALL WE HONESTLY HAVE FOR THE SAFE, and it is deliberate.
 * Before 2026-08-23 each shot was its own upload kind, so the caption could
 * have said "the roll bolts" — except that nothing verified the claim: the
 * kind came from a member's tap or from a classifier that could not tell a
 * half-open door from a shut one, and a caption asserting "the roll bolts"
 * over a photograph of a closed safe is worse than a number, because a DFO
 * reads it as our word for what the picture shows. MotivationUpload has no
 * caption column and photographs of a safe carry no text to read, so the
 * numbering says exactly what we know: which copy this is, out of how many.
 */
export function captionFor(img: AnnexureImage): string {
  const of = img.total > 1 ? ` (${img.index} of ${img.total})` : '';
  return `Annexure ${img.letter} — ${img.label}${of}`;
}

// ── image headers ───────────────────────────────────────────────────
//
// ⚠️ ONLY JPEG AND PNG, because that is all pdfkit can embed. Our own scanner
// writes JPEG, so the common path is covered; a member who picks a WebP or a
// PDF out of their files gets it stored, listed and served as normal, and
// simply not reprinted into the pack — with the index saying so, rather than
// the page silently missing.

export function isEmbeddable(mimeType: string): boolean {
  return mimeType === 'image/jpeg' || mimeType === 'image/png';
}

/**
 * Pixel dimensions from a JPEG or PNG header.
 *
 * Returns null for anything it does not confidently understand — a caller
 * that cannot measure an image must not print it, because the only
 * alternative is guessing an aspect ratio and stretching somebody's licence.
 */
export function imageSize(
  buf: Buffer,
): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: walk the segments to a start-of-frame marker and read its size.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // Standalone markers carry no length payload.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc), which are not
      // frame headers despite sitting in the same numeric range.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}
