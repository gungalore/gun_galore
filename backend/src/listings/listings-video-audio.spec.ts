// `meilisearch` ships ESM that ts-jest won't transform; the service pulls it
// in transitively and only the symbol needs to exist for these unit tests.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { ListingsService } from './listings.service';

// The seller's sound choice is a moderation gate, not a player toggle:
//  - muted  -> audio is stripped from delivery; visual-only screen
//  - sound  -> audio-inclusive screen
//  - unsure -> the listing is held in PENDING_REVIEW for an admin
//  - banned -> the clip is deleted and the upload refused

const VIDEO =
  'https://res.cloudinary.com/demo/video/upload/v1/listings/clip.mp4';

function makeService(
  over: {
    verdict?: unknown;
    existingVideo?: unknown;
  } = {},
) {
  const listingUpdate = jest.fn().mockResolvedValue({});
  const videoCreate = jest.fn((args: { data: Record<string, unknown> }) => ({
    id: 'v1',
    ...args.data,
  }));
  const videoUpdate = jest.fn(
    (args: { where: unknown; data: Record<string, unknown> }) => ({
      id: 'v1',
      url: VIDEO,
      thumbnailUrl: null,
      ...args.data,
    }),
  );
  const videoFindUnique = jest
    .fn()
    .mockResolvedValue(over.existingVideo ?? null);
  const videoDelete = jest.fn().mockResolvedValue({});
  const uploadVideo = jest.fn().mockResolvedValue({
    url: VIDEO,
    publicId: 'p1',
    thumbnailUrl: 'https://res.cloudinary.com/demo/video/upload/so_0/v1/x.jpg',
    durationSeconds: 12,
    width: 720,
    height: 1280,
  });
  const deleteVideo = jest.fn().mockResolvedValue(undefined);
  const moderateVideo = jest
    .fn()
    .mockResolvedValue(over.verdict ?? { decision: 'APPROVE', reasons: [] });

  const svc = Object.create(ListingsService.prototype) as ListingsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    prisma: {
      listing: { update: listingUpdate },
      listingVideo: {
        findUnique: videoFindUnique,
        create: videoCreate,
        delete: videoDelete,
        update: videoUpdate,
      },
    },
    cloudinary: { uploadVideo, deleteVideo },
    moderation: { moderateVideo },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    assertOwner: jest.fn().mockResolvedValue({
      id: 'l1',
      listingType: 'BUY_NOW',
      bidCount: 0,
      acceptsOffers: true,
    }),
    assertEditable: jest.fn().mockResolvedValue(undefined),
  });

  return {
    svc,
    listingUpdate,
    videoCreate,
    videoUpdate,
    videoDelete,
    uploadVideo,
    deleteVideo,
    moderateVideo,
  };
}

const file = { buffer: Buffer.from('video') } as Express.Multer.File;

describe('listing video sound choice', () => {
  it('stores a clean muted clip with a no-audio playback URL', async () => {
    const { svc, videoCreate, listingUpdate } = makeService();
    const r = await svc.addVideo('l1', 'u1', file, false);

    const mutedData: unknown = expect.objectContaining({
      audioEnabled: false,
    });
    expect(videoCreate).toHaveBeenCalledWith({ data: mutedData });
    expect(r.playbackUrl).toContain('ac_none');
    expect(r.url).toBe(r.playbackUrl);
    expect(r.heldForReview).toBe(false);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it('keeps audio in the playback URL when sound is on', async () => {
    const { svc, videoCreate } = makeService();
    const r = await svc.addVideo('l1', 'u1', file, true);

    const soundData: unknown = expect.objectContaining({
      audioEnabled: true,
    });
    expect(videoCreate).toHaveBeenCalledWith({ data: soundData });
    expect(r.playbackUrl).not.toContain('ac_none');
    expect(r.url).toBe(VIDEO);
  });

  it('holds the listing for admin when the verdict is unsure', async () => {
    const { svc, listingUpdate, videoCreate } = makeService({
      verdict: { decision: 'HUMAN_REVIEW', reasons: ['Audio unclear'] },
    });
    const r = await svc.addVideo('l1', 'u1', file, true);

    expect(r.heldForReview).toBe(true);
    expect(videoCreate).toHaveBeenCalled();
    const heldData: unknown = expect.objectContaining({
      status: 'PENDING_REVIEW',
      claudeDecision: 'HUMAN_REVIEW',
    });
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: heldData }),
    );
  });

  it('deletes and refuses a positive banned-content verdict', async () => {
    const { svc, deleteVideo, videoCreate } = makeService({
      verdict: {
        decision: 'REJECT',
        reasons: ['Spoken phone number'],
        publicReason: 'Remove the contact details.',
      },
    });
    await expect(svc.addVideo('l1', 'u1', file, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteVideo).toHaveBeenCalledWith('p1');
    expect(videoCreate).not.toHaveBeenCalled();
  });
});

describe('preview-only video preflight', () => {
  it('uploads, screens with the audio choice, deletes, and returns the verdict', async () => {
    const { svc, uploadVideo, deleteVideo, moderateVideo } = makeService({
      verdict: { decision: 'APPROVE', reasons: [] },
    });
    const r = await svc.preflightVideo(file, true);

    expect(r).toEqual({ decision: 'APPROVE', reasons: [] });
    expect(uploadVideo).toHaveBeenCalledWith(expect.any(Buffer), 'preflight');
    expect(moderateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ audioEnabled: true }),
    );
    expect(deleteVideo).toHaveBeenCalledWith('p1');
  });

  it('returns a banned verdict and still deletes the temporary asset', async () => {
    const { svc, deleteVideo } = makeService({
      verdict: {
        decision: 'REJECT',
        reasons: ['Phone number on screen'],
        publicReason: 'Remove the contact details.',
      },
    });
    const r = await svc.preflightVideo(file, true);

    expect(r).toMatchObject({
      decision: 'REJECT',
      publicReason: 'Remove the contact details.',
    });
    expect(deleteVideo).toHaveBeenCalledWith('p1');
  });

  it('deletes the asset even when screening throws', async () => {
    const { svc, deleteVideo, moderateVideo } = makeService();
    moderateVideo.mockRejectedValueOnce(new Error('provider down'));

    await expect(svc.preflightVideo(file, false)).rejects.toThrow(
      'provider down',
    );
    expect(deleteVideo).toHaveBeenCalledWith('p1');
  });
});

describe('changing sound on an existing clip', () => {
  const existing = {
    id: 'v1',
    listingId: 'l1',
    url: VIDEO,
    publicId: 'p1',
    thumbnailUrl: null,
    durationSeconds: 12,
    width: 720,
    height: 1280,
    audioEnabled: false,
  };

  it('re-screens and holds when sound-on is unsure', async () => {
    const { svc, moderateVideo, listingUpdate, videoUpdate } = makeService({
      existingVideo: existing,
      verdict: { decision: 'HUMAN_REVIEW', reasons: ['Audio unclear'] },
    });
    const r = await svc.setVideoAudio('l1', 'u1', true);

    expect(moderateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ audioEnabled: true }),
    );
    const heldData: unknown = expect.objectContaining({
      status: 'PENDING_REVIEW',
    });
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: heldData }),
    );
    expect(videoUpdate).toHaveBeenCalledWith({
      where: { listingId: 'l1' },
      data: { audioEnabled: true },
    });
    expect(r.heldForReview).toBe(true);
  });

  it('refuses sound-on when the audio is banned', async () => {
    const { svc, videoUpdate } = makeService({
      existingVideo: existing,
      verdict: { decision: 'REJECT', reasons: ['Spoken phone number'] },
    });
    await expect(svc.setVideoAudio('l1', 'u1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(videoUpdate).not.toHaveBeenCalled();
  });

  it('mutes without a screen when sound is turned off', async () => {
    const { svc, moderateVideo, videoUpdate } = makeService({
      existingVideo: { ...existing, audioEnabled: true },
    });
    const r = await svc.setVideoAudio('l1', 'u1', false);

    expect(moderateVideo).not.toHaveBeenCalled();
    expect(videoUpdate).toHaveBeenCalledWith({
      where: { listingId: 'l1' },
      data: { audioEnabled: false },
    });
    expect(r.playbackUrl).toContain('ac_none');
  });
});
