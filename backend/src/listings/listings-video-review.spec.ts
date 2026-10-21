jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ListingsService } from './listings.service';

function makeService(video: Record<string, unknown>) {
  const update = jest.fn((args: { data: Record<string, unknown> }) => ({
    ...video,
    ...args.data,
  }));
  const findMany = jest.fn().mockResolvedValue([video]);
  const findUnique = jest.fn().mockResolvedValue(video);
  const listingUpdate = jest.fn().mockResolvedValue({});
  const publishPrivateVideo = jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/demo/video/upload/v1/listings/public.mp4',
    publicId: 'public-1',
    thumbnailUrl: 'https://res.cloudinary.com/demo/video/upload/so_0/public.jpg',
    durationSeconds: 12,
    width: 720,
    height: 1280,
  });
  const deleteVideo = jest.fn().mockResolvedValue(undefined);
  const signedVideoUrl = jest.fn(
    (id: string) => `https://signed.example/${id}`,
  );
  const listingVideoApproved = jest.fn().mockResolvedValue(undefined);
  const listingVideoRejected = jest.fn().mockResolvedValue(undefined);
  const removeFromIndex = jest.fn().mockResolvedValue(undefined);

  const svc = Object.create(ListingsService.prototype) as ListingsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    prisma: {
      listingVideo: { findMany, findUnique, update },
      listing: { update: listingUpdate },
    },
    cloudinary: {
      publishPrivateVideo,
      deleteVideo,
      signedVideoUrl,
    },
    notifications: { listingVideoApproved, listingVideoRejected },
    removeFromIndex,
    logger: { warn: jest.fn() },
  });
  return {
    svc,
    update,
    findMany,
    findUnique,
    publishPrivateVideo,
    deleteVideo,
    signedVideoUrl,
    listingVideoApproved,
    listingVideoRejected,
    listingUpdate,
  };
}

const pending = {
  id: 'v1',
  listingId: 'l1',
  url: 'https://signed.example/pending',
  publicId: 'pending-1',
  thumbnailUrl: null,
  durationSeconds: 12,
  width: 720,
  height: 1280,
  audioEnabled: false,
  status: 'PENDING_REVIEW',
  moderationReasons: ['Contact details on screen'],
  listing: {
    id: 'l1',
    title: 'Distance Turret Tags',
    referenceNumber: 'UM000006',
    seller: { username: 'seller', email: 's@example.com', firstName: 'A', lastName: 'B' },
  },
};

describe('pending video admin review', () => {
  it('lists pending clips with signed preview URLs', async () => {
    const { svc } = makeService(pending);
    const rows = await svc.listPendingVideoReviews(20);

    expect(rows[0]).toMatchObject({
      id: 'v1',
      title: 'Distance Turret Tags',
      seller: 'seller',
      reasons: ['Contact details on screen'],
      url: 'https://signed.example/pending-1',
      thumbnailUrl: 'https://signed.example/pending-1',
    });
  });

  it('approves by publishing a public copy and notifying the seller', async () => {
    const { svc, publishPrivateVideo, listingVideoApproved } =
      makeService(pending);
    const result = await svc.reviewPendingVideo('v1', 'admin1', 'APPROVE');

    expect(publishPrivateVideo).toHaveBeenCalledWith('pending-1');
    expect(result).toMatchObject({
      status: 'APPROVED',
      publicId: 'public-1',
      approved: true,
    });
    expect(listingVideoApproved).toHaveBeenCalled();
  });

  it('rejects by deleting the private asset and notifying the seller', async () => {
    const { svc, deleteVideo, listingVideoRejected } = makeService(pending);
    const result = await svc.reviewPendingVideo(
      'v1',
      'admin1',
      'REJECT',
      'Phone number visible',
    );

    expect(deleteVideo).toHaveBeenCalledWith('pending-1', 'authenticated');
    expect(result).toMatchObject({ status: 'REJECTED', approved: false });
    expect(listingVideoRejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Phone number visible' }),
    );
  });
});
