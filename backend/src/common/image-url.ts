// ────────────────────────────────────────────────────────────────────
// THE SIZE AN IMAGE IS SENT TO THE MODEL AT.
//
// Every vision call fetched the Cloudinary ORIGINAL — a phone photograph of
// 12 megapixels or more — and handed the whole thing to the model. The model
// reads an image as 768-pixel tiles and bills a fixed number of tokens per
// tile, so an original costs several times the tokens of a bounded copy and
// the model sees nothing extra for it: it downsamples anyway.
//
// Cloudinary resizes on the URL for free. This inserts a bounding
// transformation after `/image/upload/` and leaves any other host alone.
//
// ⚠️ THE EDGE IS CHOSEN PER USE, NOT ONE NUMBER. A listing photograph is a
// product shot and reads perfectly at 1280. A SAPS 534, a stock-register
// page or a licence card carries small print that has to stay legible, so
// documents keep 1600. A selfie needs a face, 1024. Callers say which; the
// three constants below are the only three values in use, so a new caller
// picks one rather than inventing a fourth.
//
// `c_limit` never upscales — a small image stays small. `q_auto:good` and
// `f_jpg` keep the bytes down for the fetch without visible loss; PNG
// transparency does not matter to a model reading a document.
// ────────────────────────────────────────────────────────────────────

export const IMAGE_EDGE = {
  /** Product photographs: listing moderation, identify-from-photos. */
  photo: 1280,
  /** Forms, licences, registers, ID documents: small print must survive. */
  document: 1600,
  /** A face for matching. */
  face: 1024,
} as const;

const UPLOAD_SEGMENT = '/image/upload/';

/**
 * A Cloudinary delivery URL bounded to `maxEdge` on its longest side.
 * Any other URL is returned unchanged.
 *
 * Idempotent: a URL that already carries a `w_` bound is left as it is, so a
 * caller upstream that chose an edge is not second-guessed.
 */
export function boundedImageUrl(url: string, maxEdge: number): string {
  if (!url || !url.includes(UPLOAD_SEGMENT)) return url;
  const at = url.indexOf(UPLOAD_SEGMENT) + UPLOAD_SEGMENT.length;
  const rest = url.slice(at);
  // The first path segment after /upload/ is either a transformation list
  // (contains a comma or a known prefix) or the version/public id.
  const firstSegment = rest.split('/')[0] ?? '';
  const alreadyBounded = /(^|,)w_\d+/.test(firstSegment);
  if (alreadyBounded) return url;
  const bound = `w_${Math.max(1, Math.round(maxEdge))},h_${Math.max(1, Math.round(maxEdge))},c_limit,q_auto:good,f_jpg`;
  // An existing transformation segment (e.g. `f_jpg/`) is kept and ours is
  // prepended so both apply; Cloudinary chains slash-separated segments.
  return url.slice(0, at) + bound + '/' + rest;
}
