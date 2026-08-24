import { imageSize, isEmbeddable } from './motivation-annexure-layout';

// ────────────────────────────────────────────────────────────────────
// THE COVER PHOTOGRAPH — ours, theirs, or none.
//
// Operator, 2026-08-21: "if the system cant find one, the user has the option
// to upload one. We reserve the right to trim it to the correct aspect ratio.
// Then to crop it to fit into the predefined set limits. We can prescreen the
// image that we found to the user and ask if they want to keep or replace it."
//
// Which closes the honest gap left by the search guard. plausiblyShows() will
// only accept a photograph that is demonstrably the right make and model, and
// Wikimedia Commons simply has none for a Howa 1500 or a Beretta 686 — so the
// people most likely to get a blank cover are the ones who own the less
// photographed firearms. They are also the people holding the firearm, and a
// photograph they took of THEIR OWN is better evidence than any stock picture
// of the type could be.
//
// ⚠️ FOUR STATES, AND "NONE" IS NOT "NULL". A refusal has to be recorded, or
// the next time our search finds an image we would quietly overrule somebody
// who deliberately said they wanted no photograph on their licence
// application. See the schema comment on coverPhotoChoice.
// ────────────────────────────────────────────────────────────────────

/** What the applicant decided. `null` on the row means "not asked yet". */
export type CoverPhotoChoice = 'STOCK' | 'OWN' | 'NONE';

const CHOICES: readonly CoverPhotoChoice[] = ['STOCK', 'OWN', 'NONE'];

/**
 * Validate a choice arriving from a client.
 *
 * The column is a VarChar, so an unrecognised string would otherwise be stored
 * and then silently fall through every comparison at render time — a cover
 * that quietly reverts to the stock photograph after somebody chose "none".
 */
export function asCoverChoice(v: unknown): CoverPhotoChoice | null {
  return typeof v === 'string' && CHOICES.includes(v as CoverPhotoChoice)
    ? (v as CoverPhotoChoice)
    : null;
}

// ── The frame ───────────────────────────────────────────────────────
//
// ⚠️ THESE MUST MATCH THE COVER. The renderer draws exactly this frame and the
// browser's trim tool locks its box to exactly this ratio — so whatever sits
// inside the red box on screen is what prints, with nothing left to letterbox
// or crop a second time. Exported so there is one set of numbers, not two.

/**
 * The frame on the cover, in millimetres. FIXED.
 *
 * Operator, 2026-08-21: "we should have a fixed box. One that will fit the
 * space available for a image so the user can trim and adjust their image to
 * fit the box... so it will always fit perfectly."
 *
 * ⚠️ THIS REPLACED A FRAME THAT TOOK THE PHOTOGRAPH'S OWN SHAPE, and the fixed
 * one is better for a reason the adaptive version could not reach: every cover
 * now looks like every other cover. An adaptive frame made the first page of
 * the pack a different shape for every applicant, and the decision about what
 * the picture should show ended up being made by whoever framed the photograph
 * rather than by the person filing the application.
 *
 * ⚠️ IT WAS 86 mm WIDE AND THE COMMENT ABOVE CLAIMED THAT WAS "the full
 * content column". It was not: the column is 182 mm, so the frame occupied 47%
 * of it and left roughly 96 mm of empty page beside a photograph that had been
 * squeezed into a letterbox to fit. It was a leftover from a two-column cover
 * that no longer exists — the dossier below it is full width, and the branch
 * that once put it beside the photograph still reads
 * `input.firearmPhoto ? MARGIN : MARGIN`, both arms identical.
 *
 * Operator, 2026-08-24, with a screenshot of a lever-action rifle cut off at
 * both ends: "the box cuts the picture off. we need to make a plan so we can
 * fit almost any shape picture and that it does not screw up the documents
 * formatting."
 *
 * Full width now, and deep enough that no common shape is starved. Because the
 * renderer FITS rather than crops, the box's ratio decides how large each shape
 * prints, not whether it survives: at 182 x 85 a 16:9 rifle prints 151 mm wide,
 * a 3:2 photograph 127 mm, a square 85 mm and an upright 64 mm — all whole. A
 * shallower box (the first attempt at this was 182 x 68) is a WIDER letterbox
 * than the 86 x 44 it replaced, and would have shrunk upright photographs
 * further while appearing to fix the problem.
 */
export const COVER_FRAME_MM = { w: 182, h: 85 } as const;

/**
 * The trim tool's box, and the ONLY thing still locked to a ratio.
 *
 * ⚠️ THE FRAME NO LONGER CROPS, SO THIS IS A SUGGESTION RATHER THAN A
 * CONSTRAINT. The renderer FITS a photograph inside the frame instead of
 * filling it, so an image of any shape prints whole; the trim tool exists to
 * let somebody choose what the picture is OF, not to force it into a shape.
 * Kept because a default box that matches the frame is a sensible starting
 * point, and because the stored-pixel ceiling is expressed against it.
 */
export const COVER_ASPECT = COVER_FRAME_MM.w / COVER_FRAME_MM.h;

/**
 * The largest we store.
 *
 * ⚠️ A CEILING ON PIXELS, NOT JUST ON BYTES. pdfkit embeds JPEG data verbatim
 * — it does not re-encode — so a 12-megapixel phone photograph would add its
 * full weight to a pack that already runs to 10 MB with the annexure scans in
 * it. At 2200 px across a 182 mm frame this prints at about 307 dpi, past what
 * an office printer resolves and no further.
 *
 * ⚠️ IT ROSE WITH THE FRAME, AND HAD TO. The frame doubled in width; leaving
 * the ceiling at 1200 px would have printed the same photograph at 167 dpi —
 * visibly soft on the first page of the document, which is the one page
 * somebody looks at before deciding the rest is worth reading.
 */
export const COVER_MAX_PX = { w: 2200, h: 1028 } as const;

/**
 * Hard ceiling on the stored file.
 *
 * The client is expected to crop and re-encode before sending, so anything
 * near this is a client that did not run — accepted anyway, because a working
 * upload from an old bundle beats a rejection somebody cannot act on.
 */
export const COVER_MAX_BYTES = 4 * 1024 * 1024;

export interface CoverPhotoCheck {
  ok: boolean;
  /** Why not, phrased for the applicant. */
  problem?: string;
}

/**
 * Is this file usable as a cover photograph?
 *
 * ⚠️ MEASURED, NOT TRUSTED. The mime type on a multipart upload is whatever
 * the client wrote in the header. pdfkit throws on anything it cannot parse,
 * and that throw would land in the DOWNLOAD path — long after the upload the
 * applicant would blame — so the bytes are checked here, once, at the point
 * where there is somebody to tell.
 */
export function checkCoverPhoto(
  bytes: Buffer,
  mimeType: string,
): CoverPhotoCheck {
  if (!isEmbeddable(mimeType)) {
    return {
      ok: false,
      problem: 'Please choose a JPEG or PNG photograph.',
    };
  }
  if (bytes.length > COVER_MAX_BYTES) {
    return { ok: false, problem: 'That photograph is too large.' };
  }
  const size = imageSize(bytes);
  if (!size) {
    return {
      ok: false,
      // Deliberately about the FILE, not about them: the usual cause is a
      // renamed HEIC or a partial upload, neither of which is a mistake
      // anybody made on purpose.
      problem:
        'We could not read that image. Please try a different photograph, or save it as a JPEG first.',
    };
  }
  // A thumbnail stretched across 86 mm looks worse than no photograph. 400 px
  // across the frame is about 160 dpi — the floor at which a printed firearm
  // still reads as a photograph rather than as a blur.
  if (size.width < 400) {
    return {
      ok: false,
      problem:
        'That photograph is too small to print clearly. Please use one at least 400 pixels wide.',
    };
  }
  return { ok: true };
}
