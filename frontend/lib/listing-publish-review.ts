/**
 * Does this publish need to land in the admin queue?
 *
 * The preview and the create call run DIFFERENT moderation passes. Preview
 * receives the staged photos and can return `HUMAN_REVIEW` for a photo flag;
 * create runs before the images are uploaded, so it only sees text and would
 * return `APPROVE`. The modal promises "Will go to admin review", so the
 * publish call has to carry the verdict across — otherwise the listing goes
 * live and never appears in the review queue.
 *
 * The client-side photo screen is the second source: an image that still trips
 * after the seller blurs it is held for review even if the preview text passed.
 */
export function requiresAdminReview(
  previewDecision: string | null | undefined,
  mediaImageReviewRequired: boolean,
): boolean {
  return mediaImageReviewRequired || previewDecision === 'HUMAN_REVIEW';
}
