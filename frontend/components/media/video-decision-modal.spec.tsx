// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoDecisionModal } from './video-decision-modal';

describe('VideoDecisionModal', () => {
  it('offers exactly the three seller paths', () => {
    render(
      <VideoDecisionModal
        reason="It shows a phone number."
        onReupload={() => {}}
        onReview={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText(/phone number/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload another video/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /send for admin review/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete video/i })).toBeTruthy();
    expect(screen.getByText(/up to 24 hours/i)).toBeTruthy();
  });

  it('calls the chosen path', () => {
    const onReview = vi.fn();
    render(
      <VideoDecisionModal
        reason="Flagged."
        onReupload={() => {}}
        onReview={onReview}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send for admin review/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
