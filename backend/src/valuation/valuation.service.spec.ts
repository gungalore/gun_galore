import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ValuationService, roundTo100c, sanitiseAccessories } from './valuation.service';
import { CategoryConfigs } from './config/category-configs';

function build() {
  const prisma = {
    valuation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    valuationImage: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  } as any;
  const cloudinary = {
    uploadImage: jest.fn().mockResolvedValue({ url: 'https://x/y.jpg', publicId: 'gg/y' }),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  } as any;
  const exif = {
    strip: jest.fn().mockResolvedValue({ buffer: Buffer.from('clean'), width: 10, height: 10 }),
  } as any;
  const service = new ValuationService(
    prisma,
    cloudinary,
    exif,
    new CategoryConfigs(),
    {} as any, // ImageSelectService
    {} as any, // IdentifyService
    {} as any, // QuestionService
    {} as any, // ResearchService
    {} as any, // CompService
    {} as any, // CacheService
    {} as any, // ValuationEvents
    {} as any, // SoldCompsService
    {} as any, // ExternalSourceService
  );
  return { service, prisma, cloudinary, exif };
}

const file = { buffer: Buffer.from('raw'), mimetype: 'image/jpeg' } as Express.Multer.File;

describe('ValuationService', () => {
  it('creates a valuation with the generic checklist', async () => {
    const { service, prisma } = build();
    prisma.valuation.create.mockResolvedValue({ id: 'v1', status: 'INTAKE' });

    const out = await service.create('u1', 'a tent');

    expect(out.id).toBe('v1');
    expect(out.maxPhotos).toBe(8);
    expect(out.photoChecklist.map((c) => c.tag)).toContain('LABEL_OR_STAMP');
    expect(prisma.valuation.create).toHaveBeenCalledWith({
      data: { userId: 'u1', description: 'a tent', itemName: null },
    });
  });

  it('persists the item name given at creation', async () => {
    const { service, prisma } = build();
    prisma.valuation.create.mockResolvedValue({ id: 'v1', status: 'INTAKE' });

    await service.create('u1', undefined, '  Sako L61 Finnbear  ');

    expect(prisma.valuation.create).toHaveBeenCalledWith({
      data: { userId: 'u1', description: null, itemName: 'Sako L61 Finnbear' },
    });
  });

  it('derives the make from the member-typed name when the photos read none', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({
      itemName: 'sako .270',
      questionsJson: [
        { id: 'q2', text: 'What is the exact model name or number?', type: 'single', options: [] },
      ],
      answersJson: [
        { questionId: 'q1', custom: '.270', selected: [], unsure: false },
        { questionId: 'q2', custom: null, selected: ['Other'], unsure: false },
      ],
      identifyJson: { identification: { make: null, model: null, keySpec: '.270' } },
    });

    const spec = await (service as unknown as { deriveConfirmedSpec: (id: string) => Promise<{ make: string | null; keySpec: string | null }> }).deriveConfirmedSpec('v1');

    expect(spec.make).toBe('sako');
    expect(spec.keySpec).toBe('.270');
  });

  it('refuses to identify a valuation with no item name, before any model call', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
      status: 'INTAKE',
      itemName: null,
      description: null,
    });

    await expect(service.identify('v1', 'u1')).rejects.toMatchObject({
      response: { errorCode: 'ITEM_NAME_REQUIRED' },
    });
    expect(prisma.valuationImage.findMany).not.toHaveBeenCalled();
  });

  it('persists a supplied item name and lets identify continue past the gate', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
      status: 'INTAKE',
      itemName: null,
      description: null,
      categorySlug: null,
    });
    prisma.valuationImage.findMany.mockResolvedValue([]);

    // No photos: the gate on the item name passes, so the next failure is the
    // photo check, which proves the name was accepted.
    await expect(service.identify('v1', 'u1', undefined, 'Howa 1500')).rejects.toMatchObject({
      response: { errorCode: 'NO_PHOTOS' },
    });
    expect(prisma.valuation.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { itemName: 'Howa 1500' },
    });
  });

  it('404s when the caller does not own the valuation', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({ id: 'v1', userId: 'other' });

    await expect(service.getState('v1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an upload past the photo limit', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({ id: 'v1', userId: 'u1', status: 'INTAKE' });
    prisma.valuationImage.count.mockResolvedValue(8);

    await expect(service.addPhoto('v1', 'u1', file, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.valuationImage.create).not.toHaveBeenCalled();
  });

  it('strips metadata before uploading and persists the clean buffer', async () => {
    const { service, prisma, exif, cloudinary } = build();
    prisma.valuation.findUnique.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
      status: 'INTAKE',
      categorySlug: null,
    });
    prisma.valuationImage.count.mockResolvedValue(0);
    prisma.valuationImage.create.mockImplementation(async ({ data }: any) => ({
      id: 'img1',
      ...data,
    }));

    const out = await service.addPhoto('v1', 'u1', file, { source: 'PHONE' });

    expect(exif.strip).toHaveBeenCalledWith(file.buffer);
    expect(cloudinary.uploadImage).toHaveBeenCalledWith(
      Buffer.from('clean'),
      'valuation-photos',
    );
    expect(out.photoCount).toBe(1);
    expect(out.slotsRemaining).toBe(7);
    expect(out.image.source).toBe('PHONE');
  });

  it('nulls an unknown view tag rather than storing it', async () => {
    const { service, prisma } = build();
    prisma.valuation.findUnique.mockResolvedValue({
      id: 'v1',
      userId: 'u1',
      status: 'INTAKE',
      categorySlug: null,
    });
    prisma.valuationImage.count.mockResolvedValue(0);
    prisma.valuationImage.create.mockImplementation(async ({ data }: any) => ({ id: 'img1', ...data }));

    const out = await service.addPhoto('v1', 'u1', file, { viewTag: 'NOT_A_TAG' });
    expect(out.image.viewTag).toBeNull();
  });

  it('deletes the row and the Cloudinary asset on remove', async () => {
    const { service, prisma, cloudinary } = build();
    prisma.valuation.findUnique.mockResolvedValue({ id: 'v1', userId: 'u1' });
    prisma.valuationImage.findFirst.mockResolvedValue({ id: 'img1', publicId: 'gg/y' });

    await service.removePhoto('v1', 'u1', 'img1');

    expect(prisma.valuationImage.delete).toHaveBeenCalledWith({ where: { id: 'img1' } });
    expect(cloudinary.deleteImage).toHaveBeenCalledWith('gg/y');
  });
});

describe('roundTo100c', () => {
  it('rounds cents to the nearest R100', () => {
    expect(roundTo100c(7_686_000)).toBe(7_690_000);
    expect(roundTo100c(7_100_400)).toBe(7_100_000);
    expect(roundTo100c(1_230_000)).toBe(1_230_000);
  });
});

describe('sanitiseAccessories', () => {
  it('drops unknown keys and strips source names from the folded text', () => {
    const out = sanitiseAccessories([
      {
        name: 'Shield Arms S15 magazine',
        valueCents: 90000,
        basis: 'corroborated by theglockshop.co.za and a used Facebook Marketplace listing',
      } as never,
    ]);
    expect(Object.keys(out[0])).toEqual(['name', 'valueCents', 'note']);
    expect(out[0].note ?? '').not.toMatch(/theglockshop|Facebook|\.co\.za/i);
  });

  it('keeps a normal note', () => {
    const out = sanitiseAccessories([{ name: 'Sling', valueCents: 250, note: 'basic sling' }]);
    expect(out[0].note).toBe('basic sling');
  });
});
