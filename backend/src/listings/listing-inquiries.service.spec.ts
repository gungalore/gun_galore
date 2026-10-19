jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
jest.mock('../moderation/jev-battery', () => ({
  jevLadder: jest.fn(),
  contactQuestions: () => ({}),
  conductQuestions: () => ({}),
  JEV_CATEGORY_REASONS: {},
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ListingInquiriesService } from './listing-inquiries.service';
import { jevLadder } from '../moderation/jev-battery';

const jev = jevLadder as unknown as jest.Mock;

function imageFile(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('img'),
    ...over,
  } as Express.Multer.File;
}

function videoFile(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    mimetype: 'video/mp4',
    size: 1024,
    buffer: Buffer.from('vid'),
    ...over,
  } as Express.Multer.File;
}

function makeService(
  over: {
    inquiry?: Record<string, unknown>;
    verdict?: { decision: string; reasons?: string[]; publicReason?: string };
    redact?: { text: string; categories: string[] };
  } = {},
) {
  const inquiry =
    over.inquiry === undefined
      ? {
          id: 'INQ1',
          listingId: 'L1',
          buyerId: 'B',
          sellerId: 'S',
          listing: { title: 'Scope' },
          buyer: { email: 'b@x.co', firstName: 'B' },
          seller: { email: 's@x.co', firstName: 'S' },
        }
      : over.inquiry;

  const prisma = {
    listingInquiry: {
      findUnique: jest.fn().mockResolvedValue(inquiry),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    listingInquiryMessage: {
      create: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
        const spec =
          (a.data.media as { create?: Record<string, unknown>[] } | undefined)
            ?.create ?? [];
        const media = spec.map((m, i) => ({ id: `m${i}`, ...m }));
        return {
          ...a.data,
          id: 'M1',
          createdAt: new Date('2026-10-19T10:00:00Z'),
          media,
        };
      }),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const contactFilter = {
    redact: jest
      .fn()
      .mockReturnValue(over.redact ?? { text: 'clean', categories: [] }),
  };
  const notifications = { listingInquiryMessage: jest.fn().mockResolvedValue(undefined) };
  const cloudinary = {
    uploadImage: jest
      .fn()
      .mockResolvedValue({ url: 'https://cdn/i.jpg', publicId: 'i' }),
    uploadVideo: jest.fn().mockResolvedValue({
      url: 'https://cdn/v.mp4',
      publicId: 'v',
      thumbnailUrl: 'https://cdn/v.jpg',
      durationSeconds: 4,
      width: 720,
      height: 1280,
    }),
    deleteImage: jest.fn().mockResolvedValue(undefined),
    deleteVideo: jest.fn().mockResolvedValue(undefined),
  };
  const moderation = {
    moderateInquiryMedia: jest
      .fn()
      .mockResolvedValue(over.verdict ?? { decision: 'APPROVE', reasons: [] }),
  };

  const service = new ListingInquiriesService(
    prisma as never,
    contactFilter as never,
    {} as never,
    notifications as never,
    cloudinary as never,
    moderation as never,
  );
  return { service, prisma, cloudinary, moderation, notifications };
}

describe('ListingInquiriesService', () => {
  beforeEach(() => {
    jev.mockResolvedValue({ decision: 'PASS', category: null, reason: null });
  });

  it('refuses buyer media before anything is uploaded (seller-only rule)', async () => {
    const { service, cloudinary } = makeService();
    await expect(
      service.sendMedia('INQ1', 'B', { images: [imageFile()] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('rejects a non-participant', async () => {
    const { service } = makeService();
    await expect(
      service.sendMessage('INQ1', 'X', 'hello'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deletes uploaded media when screening REJECTS it', async () => {
    const { service, prisma, cloudinary } = makeService({
      verdict: { decision: 'REJECT', reasons: ['phone number in photo'] },
    });

    await expect(
      service.sendMedia('INQ1', 'S', {
        images: [imageFile()],
        video: videoFile(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(cloudinary.deleteImage).toHaveBeenCalledWith('i');
    expect(cloudinary.deleteVideo).toHaveBeenCalledWith('v');
    expect(prisma.listingInquiryMessage.create).not.toHaveBeenCalled();
  });

  it('deletes uploaded media when screening is UNSURE (fail closed)', async () => {
    const { service, prisma, cloudinary } = makeService({
      verdict: { decision: 'HUMAN_REVIEW', reasons: ['unsure'] },
    });

    await expect(
      service.sendMedia('INQ1', 'S', { video: videoFile() }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(cloudinary.deleteVideo).toHaveBeenCalledWith('v');
    expect(prisma.listingInquiryMessage.create).not.toHaveBeenCalled();
  });

  it('stores seller media only after it passes screening', async () => {
    const { service, prisma } = makeService();
    await service.sendMedia('INQ1', 'S', {
      images: [imageFile()],
      video: videoFile(),
    });

    expect(prisma.listingInquiryMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inquiryId: 'INQ1',
          senderId: 'S',
          media: {
            create: expect.arrayContaining([
              expect.objectContaining({ kind: 'IMAGE' }),
              expect.objectContaining({ kind: 'VIDEO' }),
            ]),
          },
        }),
      }),
    );
  });

  it('auto-strips contact details on text but still sends', async () => {
    const { service, prisma } = makeService({
      redact: { text: 'call [removed]', categories: ['phone'] },
    });

    const msg = await service.sendMessage('INQ1', 'B', 'call 0821234567');

    expect(prisma.listingInquiryMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'call [removed]',
          originalContent: 'call 0821234567',
          wasModerated: true,
        }),
      }),
    );
    expect(msg.content).toBe('call [removed]');
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('blocks abuse outright', async () => {
    jev.mockResolvedValue({ decision: 'BLOCK', category: 'abuse', reason: 'no' });
    const { service, prisma } = makeService();

    await expect(
      service.sendMessage('INQ1', 'B', 'you are an idiot'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.listingInquiryMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized image with a seller-facing reason', async () => {
    const { service, cloudinary } = makeService();
    await expect(
      service.sendMedia('INQ1', 'S', {
        images: [imageFile({ size: 9 * 1024 * 1024 })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });
});
