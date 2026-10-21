// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaReview } from './use-media-review';

function file(name: string, type: string) {
  return new File(['bytes'], name, { type });
}

afterEach(() => vi.unstubAllGlobals());

describe('useMediaReview', () => {
  it('screens a photo and enqueues a fix when it is flagged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          decision: 'HUMAN_REVIEW',
          reasons: ['Phone number visible in photo 1'],
          categories: ['photo-contact-info'],
          photoFlags: [
            {
              index: 1,
              categories: ['photo-contact-info'],
              reason: 'Phone number visible in photo 1',
            },
          ],
        }),
      }),
    );
    const { result } = renderHook(() =>
      useMediaReview(async () => 'token', 'http://api'),
    );
    const photo = file('one.jpg', 'image/jpeg');

    act(() => result.current.syncImages([photo]));

    await waitFor(() => expect(result.current.current?.kind).toBe('image'));
    expect(result.current.imageStatusFor(photo)).toBe('needs-fix');
    expect(result.current.allSettled).toBe(false);
  });

  it('turns a flagged video into the admin-review decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          decision: 'REJECT',
          reasons: ['Phone number on screen'],
          publicReason: 'Remove the contact details.',
        }),
      }),
    );
    const { result } = renderHook(() =>
      useMediaReview(async () => 'token', 'http://api'),
    );
    const clip = file('clip.mp4', 'video/mp4');

    act(() => result.current.syncVideo(clip, false));
    await waitFor(() => expect(result.current.current?.kind).toBe('video'));

    act(() => result.current.chooseVideoReview());
    expect(result.current.videoAction).toBe('review');
    expect(result.current.queue).toHaveLength(0);
    expect(result.current.allSettled).toBe(true);
  });
});
