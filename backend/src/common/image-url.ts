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

const VIDEO_UPLOAD_SEGMENT = '/video/upload/';

/**
 * A Cloudinary video delivery URL bounded to `maxEdge` and re-encoded, so the
 * bytes fetched are a fraction of the original.
 *
 * ⚠️ WHY THIS EXISTS. A phone video is tens of MB and Gemini's inline-data
 * request tops out near 20 MB, so the original could not be sent for
 * moderation. Cloudinary transcodes on request; a 720p `q_auto:eco` MP4 is
 * usually well under the cap. Any non-Cloudinary URL is returned unchanged.
 *
 * `f_mp4` pins the container (Gemini accepts mp4/webm/mov) and `c_limit`
 * never upscales.
 */
export function boundedVideoUrl(url: string, maxEdge: number): string {
  if (!url || !url.includes(VIDEO_UPLOAD_SEGMENT)) return url;
  const at = url.indexOf(VIDEO_UPLOAD_SEGMENT) + VIDEO_UPLOAD_SEGMENT.length;
  const rest = url.slice(at);
  const firstSegment = rest.split('/')[0] ?? '';
  if (/(^|,)w_\d+/.test(firstSegment)) return url;
  // ⚠️ `ac_none` STRIPS THE AUDIO. Moderation is visual-only (gore), so the
  // soundtrack is dead weight — dropping it shrinks the clip and keeps it under
  // Gemini's inline cap. Playback uses optimizedVideoUrl, which keeps audio.
  const bound = `w_${Math.max(1, Math.round(maxEdge))},c_limit,q_auto:eco,f_mp4,ac_none`;
  return url.slice(0, at) + bound + '/' + rest;
}

/**
 * A compressed-but-complete delivery URL for PLAYBACK — audio kept, only the
 * cost trimmed. Never used for moderation.
 */
export function optimizedVideoUrl(url: string, maxEdge: number): string {
  if (!url || !url.includes(VIDEO_UPLOAD_SEGMENT)) return url;
  const at = url.indexOf(VIDEO_UPLOAD_SEGMENT) + VIDEO_UPLOAD_SEGMENT.length;
  const rest = url.slice(at);
  const firstSegment = rest.split('/')[0] ?? '';
  if (/(^|,)w_\d+/.test(firstSegment)) return url;
  const bound = `w_${Math.max(1, Math.round(maxEdge))},c_limit,q_auto,f_mp4`;
  return url.slice(0, at) + bound + '/' + rest;
}

/** Edge used when compressing a video for a model (not for playback). */
export const VIDEO_MODEL_EDGE = 720;
