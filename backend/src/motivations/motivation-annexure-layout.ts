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
  /** Original bytes, retained by the renderer when it maps placements back. */
  bytes?: Buffer;
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
  /**
   * This copy takes a page of its own, however small it is.
   *
   * ⚠️ SET FOR AN EVIDENCE ANNEXURE, AND ONLY THERE. The operator's decision
   * is that an evidence item placed in the annexures — a farmer's permission
   * letter, an affidavit, a score sheet — "gets its own full page". A small
   * permission letter would otherwise share a sheet with whatever follows it,
   * and a page holding two different annexures is one a DFO cannot hand to a
   * commissioner of oaths as a single document. Ordinary copies keep the
   * pack-as-many-as-fit rule.
   */
  solo?: boolean;
  /**
   * A licence-card copy, which the run packs three to a sheet.
   *
   * ⚠️ THE CALLER ALSO PASSES `perPage: 3` FOR SUCH A RUN. This flag lets the
   * planner know a downscale is intended, so the full-width rule in the header
   * above still holds for every other annexure. Operator, 2026-10-15: "we can
   * fit 3 licenses per page."
   */
  threeUp?: boolean;
}

export interface PlacedImage extends AnnexureImage {
  /** Top-left of the image, in PDF points from the page's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Baseline box for the caption, directly above the image. */
  captionY: number;
  /**
   * Where the caption starts, and how wide it may run.
   *
   * ⚠️ NOT THE IMAGE'S OWN x/w. A copy is centred inside its cell when it is
   * height-limited, so a caption drawn at the image's x and width would sit
   * off-centre in a column that is wider than the picture. These are the
   * COLUMN's edges instead — the full content width for an ordinary copy, one
   * cell for a 2x2 safe sheet.
   *
   * ⚠️ AND THE SAFE SHEET IS WHY IT EXISTS. Two cells share one `captionY` row,
   * and the renderer used to draw every caption at the page margin — so the
   * left cell's caption printed twice, overprinted, and the right cell had
   * none at all.
   */
  captionX: number;
  captionW: number;
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
 * Height reserved under a copy for the STAMP block, in points.
 *
 * ⚠️ 170pt ≈ 60 mm — the square block the operator asked for (2026-10-15:
 * "just add a 60mm x 60mm block at the bottom with the heading stamp"). The
 * old 92pt strip held a four-field commissioner frame with a 40 mm round
 * stamp beside it; that frame is gone, and this reserves the whole square.
 * A full-page A4 copy now scales to leave 60 mm of clear paper beneath it.
 */
export const STAMP_H = 170;

/**
 * Pack images onto pages.
 *
 * `openingHeadingH` reserves room at the top of the FIRST page only, for the
 * "Annexure X" heading drawn there (the divider sheet was removed — operator,
 * 2026-10-15). Later pages get the full box. Default 0 keeps the old packing
 * exactly, so the arithmetic tests are unaffected.
 *
 * @returns one array of placements per page, in order.
 */
export function planAnnexurePages(
  images: AnnexureImage[],
  box: LayoutBox,
  openingHeadingH = 0,
  opts: { perPage?: number } = {},
): PlacedImage[][] {
  const pages: PlacedImage[][] = [];
  let page: PlacedImage[] = [];
  let top = box.y + openingHeadingH;
  let avail = box.height - openingHeadingH;
  let cursor = top;

  /**
   * ⚠️ A UNIFORM PER-PAGE BUDGET WHEN A RUN PACKS MORE THAN TWO-UP.
   *
   * Licence cards go three to a sheet (operator, 2026-10-15). Sizing every card
   * to the FIRST page's room — the shorter one, because it also carries the
   * annexure heading — keeps the run uniform and guarantees three fit on every
   * sheet, the headered one included. Absent (or 1) keeps the old full-width
   * packing exactly, so every other annexure is untouched.
   */
  const perPage = Math.max(1, Math.floor(opts.perPage ?? 0));
  const budgetH =
    perPage > 1
      ? Math.max(
          0,
          // ⚠️ ONE POINT OF SLACK. Sizing three cards to the sheet exactly
          // leaves the third on a boundary the break test can lose to floating
          // point — 648.90 against 648.89 — and the headered page then holds
          // two. The point is invisible on the paper and buys the guarantee.
          (box.height -
            openingHeadingH -
            perPage * CAPTION_H -
            (perPage - 1) * GAP -
            1) /
            perPage,
        )
      : Number.POSITIVE_INFINITY;

  for (const img of images) {
    // Full content width, unless that makes it taller than a whole page.
    const ratio = img.width > 0 && img.height > 0 ? img.height / img.width : 1;
    const stampH = img.stamp ? STAMP_H : 0;
    let w = box.width;
    let h = w * ratio;
    const maxH = avail - CAPTION_H - stampH;
    // A solo copy is never shrunk to share; every other copy is capped by the
    // per-page budget when the run packs more than two-up.
    const cap = img.solo ? maxH : Math.min(maxH, budgetH);
    if (h > cap) {
      h = cap;
      w = ratio > 0 ? h / ratio : box.width;
    }

    const need = CAPTION_H + h + stampH;
    const used = cursor - top;
    // ⚠️ A SOLO COPY ALWAYS STARTS A FRESH SHEET. Its own full page means it
    // shares with neither what came before nor what follows.
    if (img.solo && page.length > 0) {
      pages.push(page);
      page = [];
      top = box.y;
      avail = box.height;
      cursor = top;
    }
    // ⚠️ THE FIRST IMAGE NEVER BREAKS. Without this a single image taller
    // than the box would loop forever pushing itself to a fresh page.
    if (page.length > 0 && used + GAP + need > avail) {
      pages.push(page);
      page = [];
      top = box.y;
      avail = box.height;
      cursor = top;
    }
    if (page.length > 0) cursor += GAP;

    page.push({
      ...img,
      captionY: cursor,
      captionX: box.x,
      captionW: box.width,
      // Centred horizontally, which matters for the height-limited case where
      // the image is narrower than the content area.
      x: box.x + (box.width - w) / 2,
      y: cursor + CAPTION_H,
      w,
      h,
      ...(img.stamp ? { stampY: cursor + CAPTION_H + h + 8 } : {}),
    });
    cursor += need;
    // …and nothing follows it onto that sheet either.
    if (img.solo) {
      pages.push(page);
      page = [];
      top = box.y;
      avail = box.height;
      cursor = top;
    }
  }

  if (page.length > 0) pages.push(page);
  return pages;
}

/** Pack safe photographs as a compact 2x2 sheet, never more than four. */
export function planSafePhotoPages(
  images: AnnexureImage[],
  box: LayoutBox,
): PlacedImage[][] {
  const pages: PlacedImage[][] = [];
  const cellW = (box.width - GAP) / 2;
  const cellH = (box.height - GAP) / 2;
  for (let offset = 0; offset < images.length; offset += 4) {
    const page: PlacedImage[] = [];
    for (const [slot, img] of images.slice(offset, offset + 4).entries()) {
      const ratio =
        img.width > 0 && img.height > 0 ? img.height / img.width : 1;
      const w = Math.min(cellW, cellH / ratio);
      const h = w * ratio;
      const col = slot % 2;
      const row = Math.floor(slot / 2);
      const cellX = box.x + col * (cellW + GAP);
      const cellY = box.y + row * (cellH + GAP);
      page.push({
        ...img,
        x: cellX + (cellW - w) / 2,
        y: cellY + CAPTION_H,
        w,
        h,
        captionY: cellY,
        // ⚠️ THE CELL, NOT THE PAGE. See PlacedImage.captionX: both cells of a
        // row share the caption's y, so a page-margin x printed the left
        // cell's caption twice and left the right cell unlabelled.
        captionX: cellX,
        captionW: cellW,
      });
    }
    pages.push(page);
  }
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

/**
 * The caption for a copy sitting directly UNDER its annexure's own heading.
 *
 * ⚠️ THE FULL CAPTION REPEATS THE HEADING, WORD FOR WORD, FOUR MILLIMETRES
 * BELOW IT. `drawAnnexureHeading` prints "Annexure A — Copy of the applicant's
 * identity document" at the top of the letter's first page; `captionFor` then
 * printed the identical line above the copy. On a one-item annexure the page
 * carried the same sentence twice, which reads as a layout fault rather than an
 * index.
 *
 * So the headered page prints the compact form: the letter and the position
 * only, and nothing at all where there is one copy and the heading already
 * says everything.
 *
 * Continuation pages — and every page of a 2x2 safe sheet that does not open
 * the letter — keep the full caption, because there the heading is not on the
 * sheet to identify what the reader is looking at.
 */
export function compactCaption(img: AnnexureImage): string {
  if (img.total <= 1) return '';
  return `Annexure ${img.letter} (${img.index} of ${img.total})`;
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
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
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
