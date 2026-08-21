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
 * The full content column wide and a shallow letterbox tall, because the
 * subject is almost always a firearm and a firearm is long and thin. A rifle
 * sits in this comfortably; a handgun sits in it with background either side,
 * which is what a handgun photographed on a bench looks like anyway.
 */
export const COVER_FRAME_MM = { w: 86, h: 44 } as const;

/** The one aspect ratio. The browser's trim box is locked to it. */
export const COVER_ASPECT = COVER_FRAME_MM.w / COVER_FRAME_MM.h;

/**
 * The largest we store.
 *
 * ⚠️ A CEILING ON PIXELS, NOT JUST ON BYTES. pdfkit embeds JPEG data verbatim
 * — it does not re-encode — so a 12-megapixel phone photograph would add its
 * full weight to a pack that already runs to 10 MB with the annexure scans in
 * it, to fill a frame 86 mm wide. At 1200 px the frame prints at roughly 355
 * dpi, which is past what any office printer resolves.
 */
export const COVER_MAX_PX = { w: 1200, h: 614 } as const;

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
