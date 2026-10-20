import {
  boundedImageUrl,
  boundedVideoUrl,
  IMAGE_EDGE,
  optimizedVideoUrl,
} from './image-url';

describe('boundedImageUrl', () => {
  const original =
    'https://res.cloudinary.com/demo/image/upload/v1712345678/listings/abc.jpg';

  it('bounds a Cloudinary original to the edge, never upscaling', () => {
    expect(boundedImageUrl(original, IMAGE_EDGE.photo)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1280,h_1280,c_limit,q_auto:good,f_jpg/v1712345678/listings/abc.jpg',
    );
  });

  it('keeps an existing transformation and chains ours before it', () => {
    const jpg =
      'https://res.cloudinary.com/demo/image/upload/f_jpg/v1/kyc/id.png';
    expect(boundedImageUrl(jpg, IMAGE_EDGE.document)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1600,h_1600,c_limit,q_auto:good,f_jpg/f_jpg/v1/kyc/id.png',
    );
  });

  it('does not bound twice', () => {
    const once = boundedImageUrl(original, IMAGE_EDGE.face);
    expect(boundedImageUrl(once, IMAGE_EDGE.face)).toBe(once);
    expect(
      boundedImageUrl(
        'https://res.cloudinary.com/demo/image/upload/c_fill,w_400/v1/a.jpg',
        IMAGE_EDGE.photo,
      ),
    ).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_fill,w_400/v1/a.jpg',
    );
  });

  it('leaves any other host alone', () => {
    expect(boundedImageUrl('https://example.com/a.jpg', 1280)).toBe(
      'https://example.com/a.jpg',
    );
    expect(boundedImageUrl('', 1280)).toBe('');
  });

  it('has exactly three edges, one per kind of picture', () => {
    expect(IMAGE_EDGE).toEqual({ photo: 1280, document: 1600, face: 1024 });
  });
});

describe('video delivery transformations', () => {
  const video =
    'https://res.cloudinary.com/demo/video/upload/v1712345678/listings/clip.mp4';

  it('strips audio for visual-only moderation by default', () => {
    expect(boundedVideoUrl(video, 720)).toBe(
      'https://res.cloudinary.com/demo/video/upload/w_720,c_limit,q_auto:eco,f_mp4,ac_none/v1712345678/listings/clip.mp4',
    );
  });

  it('keeps audio for moderation when the seller chose sound', () => {
    const withAudio = boundedVideoUrl(video, 720, true);
    expect(withAudio).toContain('w_720,c_limit,q_auto:eco,f_mp4');
    expect(withAudio).not.toContain('ac_none');
  });

  it('keeps audio for normal playback by default', () => {
    expect(optimizedVideoUrl(video, 720)).not.toContain('ac_none');
  });

  it('removes audio from the delivered file when the listing is muted', () => {
    expect(optimizedVideoUrl(video, 720, false)).toContain('ac_none');
  });
});
