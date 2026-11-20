// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageGallery } from '../app/listings/[id]/image-gallery';

// jsdom has no IntersectionObserver and no media playback. The gallery only
// needs the callback to fire as "fully visible"; the rest of the observer
// contract is irrelevant to the assertions.
class VisibleIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
          target,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

describe('ImageGallery video autoplay', () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      VisibleIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    pause = vi
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Unmount while the media spies are still in place; jsdom's real pause()
    // is "not implemented" and prints noise during cleanup otherwise.
    cleanup();
    vi.unstubAllGlobals();
    play.mockRestore();
    pause.mockRestore();
  });

  it('plays a hero video as soon as it is visible', async () => {
    render(
      <ImageGallery
        images={[]}
        title="Test listing"
        video={{
          id: 'v1',
          url: 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
          isHero: true,
          audioEnabled: false,
        }}
      />,
    );

    expect(screen.getByLabelText('Test listing video')).toBeInTheDocument();
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('plays a non-hero video when the viewer selects it and it comes into view', async () => {
    render(
      <ImageGallery
        images={[
          {
            id: 'i1',
            url: 'https://res.cloudinary.com/demo/image/upload/v1/photo.jpg',
            isPrimary: true,
          },
        ]}
        title="Test listing"
        video={{
          id: 'v1',
          url: 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
          isHero: false,
          audioEnabled: false,
        }}
      />,
    );

    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show video' }));
    await waitFor(() => expect(play).toHaveBeenCalled());
  });
});
