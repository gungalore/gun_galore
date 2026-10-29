jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { ListingsService } from './listings.service';

function makeService(rows: unknown[], configured = true) {
  const deleteImages = jest.fn().mockResolvedValue(undefined);
  const deleteVideo = jest.fn().mockResolvedValue(undefined);
  const update = jest.fn().mockResolvedValue({});
  const deleteManyImages = jest.fn().mockResolvedValue({ count: 1 });
  const deleteManyVideos = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    listing: { findMany, update },
    listingImage: { deleteMany: deleteManyImages },
    listingVideo: { deleteMany: deleteManyVideos },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const svc = Object.create(ListingsService.prototype) as Record<string, any>;
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    prisma,
    cloudinary: {
      isConfigured: () => configured,
      deleteImages,
      deleteVideo,
    },
    removeFromIndex: jest.fn().mockResolvedValue(undefined),
  });
  return {
    svc: svc as ListingsService,
    findMany,
    update,
    deleteImages,
    deleteVideo,
    deleteManyImages,
    deleteManyVideos,
  };
}

const oldDate = new Date(Date.now() - 120 * 86_400_000);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    title: 'Old cancelled listing',
    updatedAt: oldDate,
    images: [{ publicId: 'img-1' }, { publicId: 'img-2' }],
    video: { publicId: 'video-1' },
    ...overrides,
  };
}

describe('archiveStaleCancelledListings', () => {
  it('is a dry run by default and touches no media', async () => {
    const { svc, findMany, update, deleteImages } = makeService([row()]);

    const result = await svc.archiveStaleCancelledListings();

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.archived).toBe(0);
    expect(deleteImages).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CANCELLED',
          archivedAt: null,
          transactions: { none: {} },
          orderLineItems: { none: {} },
        }),
      }),
    );
  });

  it('deletes media, hides the listing, and keeps the row', async () => {
    const {
      svc,
      update,
      deleteImages,
      deleteVideo,
      deleteManyImages,
      deleteManyVideos,
    } = makeService([row()]);

    const result = await svc.archiveStaleCancelledListings({
      dryRun: false,
      olderThanDays: 90,
    });

    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
    expect(deleteImages).toHaveBeenCalledWith(['img-1', 'img-2']);
    expect(deleteVideo).toHaveBeenCalledWith('video-1');
    expect(deleteManyImages).toHaveBeenCalledWith({
      where: { listingId: 'listing-1' },
    });
    expect(deleteManyVideos).toHaveBeenCalledWith({
      where: { listingId: 'listing-1' },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'listing-1' },
        data: expect.objectContaining({
          archivedAt: expect.any(Date),
          mediaPurgedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('refuses to delete DB media rows when Cloudinary is not configured', async () => {
    const { svc, deleteImages, update } = makeService([row()], false);

    const result = await svc.archiveStaleCancelledListings({
      dryRun: false,
    });

    expect(result.failed).toBe(1);
    expect(result.archived).toBe(0);
    expect(deleteImages).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
