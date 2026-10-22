import { describe, it, expect } from 'vitest';
import { requiresAdminReview } from './listing-publish-review';

/**
 * The failure this guards: preview says HUMAN_REVIEW ("Will go to admin
 * review"), create re-moderates text only and returns APPROVE, so the listing
 * went ACTIVE and never entered the queue. The preview verdict must survive
 * into the publish payload.
 */
describe('requiresAdminReview', () => {
  it('holds a HUMAN_REVIEW preview even when the client photo screen passed', () => {
    expect(requiresAdminReview('HUMAN_REVIEW', false)).toBe(true);
  });

  it('holds a photo the client screen could not clear', () => {
    expect(requiresAdminReview('APPROVE', true)).toBe(true);
  });

  it('does not hold an approved listing', () => {
    expect(requiresAdminReview('APPROVE', false)).toBe(false);
  });

  it('does not hold an auto-fixed listing', () => {
    expect(requiresAdminReview('AUTO_FIX_AND_APPROVE', false)).toBe(false);
  });

  it('does not hold when the preview never ran', () => {
    expect(requiresAdminReview(undefined, false)).toBe(false);
  });
});
