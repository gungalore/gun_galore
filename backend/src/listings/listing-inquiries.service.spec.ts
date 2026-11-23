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
          messages: [],
        }
      : over.inquiry;

  const prisma = {
    listing: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'L1',
        sellerId: 'S',
        status: 'ACTIVE',
        title: 'Scope',
      }),
    },
    listingInquiry: {
      // `findUnique` serves two shapes: the participant lookup (returns the
      // thread) and the "does this buyer already have a thread?" probe, which
      // must answer null so a first message can reach the FAQ check.
      findUnique: jest.fn().mockImplementation((args: { where?: Record<string, unknown> }) =>
        args?.where && 'listingId_buyerId' in args.where
          ? Promise.resolve(null)
          : Promise.resolve(inquiry),
      ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 'INQ1' }),
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
  const notifications = {
    listingInquiryMessage: jest.fn().mockResolvedValue(undefined),
    resolveByEntity: jest.fn().mockResolvedValue(0),
  };
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
  // Public Q&A side-car. Default: nothing has been answered yet.
  const faq = {
    match: jest.fn().mockResolvedValue(null),
    distil: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ListingInquiriesService(
    prisma as never,
    contactFilter as never,
    {} as never,
    notifications as never,
    cloudinary as never,
    moderation as never,
    faq as never,
  );
  return { service, prisma, cloudinary, moderation, notifications, faq };
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

  it('clears the message alert when the thread is opened', async () => {
    const { service, notifications } = makeService();
    await service.getThread('INQ1', 'B');

    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'listing_inquiry',
      'INQ1',
      { userId: 'B', types: ['listing_inquiry_message'] },
    );
  });

  it('clears the sender alert when replying', async () => {
    const { service, notifications } = makeService();
    await service.sendMessage('INQ1', 'B', 'still interested');

    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'listing_inquiry',
      'INQ1',
      { userId: 'B', types: ['listing_inquiry_message'] },
    );
  });

  // ⚠️ THE FAQ COMES FIRST. A question the listing has already answered
  // publicly must not open a thread or notify the seller; the buyer is handed
  // the answer instead. `force` is the only bypass (the "ask anyway" button).
  it('answers a duplicate from the public FAQ without creating a thread', async () => {
    const { service, prisma, faq } = makeService();
    faq.match.mockResolvedValue({
      id: 'F1',
      question: 'Does it come with a case?',
      answer: 'Yes, it ships with the hard case shown.',
    });

    const res = await service.sendAsBuyer('L1', 'B', 'Does it have a case?');

    expect(res).toMatchObject({ answeredFromFaq: true });
    expect(prisma.listingInquiry.upsert).not.toHaveBeenCalled();
    expect(prisma.listingInquiryMessage.create).not.toHaveBeenCalled();
  });

  it('lets the buyer ask anyway with force', async () => {
    const { service, prisma, faq } = makeService();
    faq.match.mockResolvedValue({
      id: 'F1',
      question: 'Does it come with a case?',
      answer: 'Yes.',
    });

    await service.sendAsBuyer('L1', 'B', 'Does it have a case?', {
      force: true,
    });

    expect(faq.match).not.toHaveBeenCalled();
    expect(prisma.listingInquiry.upsert).toHaveBeenCalled();
    expect(prisma.listingInquiryMessage.create).toHaveBeenCalled();
  });

  it('stamps the seller first-reply time and distils an answered thread', async () => {
    const { service, prisma, faq } = makeService();
    await service.sendMessage('INQ1', 'S', 'Yes, it comes with the case.');

    expect(prisma.listingInquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'INQ1', sellerFirstReplyAt: null },
        data: expect.objectContaining({ sellerFirstReplyAt: expect.any(Date) }),
      }),
    );
    expect(faq.distil).toHaveBeenCalledWith('INQ1');
  });

  it('does not intercept a follow-up in an existing thread', async () => {
    const { service, prisma, faq } = makeService();
    // First call (the thread-existence probe) says the thread already exists.
    prisma.listingInquiry.findUnique.mockResolvedValueOnce({ id: 'INQ1' });

    await service.sendAsBuyer('L1', 'B', 'One more question about the case.');

    expect(faq.match).not.toHaveBeenCalled();
    expect(prisma.listingInquiry.upsert).not.toHaveBeenCalled();
    expect(prisma.listingInquiryMessage.create).toHaveBeenCalled();
  });

  it('does not treat a buyer message as a seller reply', async () => {
    const { service, prisma, faq } = makeService();
    await service.sendMessage('INQ1', 'B', 'still interested');

    expect(prisma.listingInquiry.updateMany).not.toHaveBeenCalled();
    expect(faq.distil).not.toHaveBeenCalled();
  });
});
